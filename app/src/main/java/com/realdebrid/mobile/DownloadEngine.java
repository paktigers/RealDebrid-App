package com.realdebrid.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Environment;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.LinkedHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The app's own download manager: pause, resume, stop, automatic retry, a queue with a limit of
 * parallel downloads, and it survives the app being closed (a foreground service keeps it running).
 * Tasks are saved, so after a restart they are listed as paused and can be resumed.
 */
final class DownloadEngine {

    static final int QUEUED = 0, RUNNING = 1, PAUSED = 2, DONE = 3, FAILED = 4, STOPPED = 5;

    static final class Task {
        long id;
        String url, name, sub, uri = "";
        volatile int state = QUEUED;
        volatile long done = 0, total = -1;
        volatile double speed = 0;
        volatile String error = "";
        long lastBytes, lastTime;
        boolean wantResume, removeAfter;
        ResumableDownload dl;
        ResumableDownload.Sink sink;
    }

    static final class Summary {
        int active, queued;
        long done, total;
        double speed;
        String firstName = "";
    }

    private static DownloadEngine instance;

    static synchronized DownloadEngine get(Context c) {
        if (instance == null) instance = new DownloadEngine(c.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final SharedPreferences prefs;
    private final LinkedHashMap<Long, Task> tasks = new LinkedHashMap<>();
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private int maxParallel;
    private long nextId;
    private long lastRefresh = 0;

    private DownloadEngine(Context c) {
        ctx = c;
        prefs = c.getSharedPreferences("dl_engine", Context.MODE_PRIVATE);
        maxParallel = prefs.getInt("parallel", 3);
        nextId = prefs.getLong("next", 1);
        load();
    }

    // ------------------------------------------------------------------ helpers
    private static String cleanSeg(String s) {
        String r = s == null ? "" : s.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (r.startsWith(".")) r = "_" + r.substring(1);
        return r.isEmpty() ? "_" : r;
    }

    private static String cleanPath(String s) {
        StringBuilder sb = new StringBuilder();
        if (s != null) {
            for (String part : s.split("/")) {
                if (part.isEmpty() || part.equals(".") || part.equals("..")) continue;
                if (sb.length() > 0) sb.append('/');
                sb.append(cleanSeg(part));
            }
        }
        return sb.toString();
    }

    private ResumableDownload.Sink sinkFor(Task t) {
        if (t.sink == null) {
            if (Build.VERSION.SDK_INT >= 29) {
                t.sink = new MediaStoreSink(ctx, t.name, t.sub, t.uri);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                        "RealDebrid" + (t.sub.isEmpty() ? "" : "/" + t.sub));
                t.sink = new FileSink(new File(dir, t.name));
            }
        }
        return t.sink;
    }

    private void syncUri(Task t) {
        if (t.sink instanceof MediaStoreSink) t.uri = ((MediaStoreSink) t.sink).uriString();
    }

    // ------------------------------------------------------------------ persistence
    private void load() {
        try {
            JSONArray a = new JSONArray(prefs.getString("tasks", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Task t = new Task();
                t.id = o.getLong("id");
                t.url = o.getString("url");
                t.name = o.getString("name");
                t.sub = o.optString("sub");
                t.uri = o.optString("uri");
                int st = o.optInt("state", PAUSED);
                t.state = (st == RUNNING || st == QUEUED) ? PAUSED : st;   // the app was closed: wait for the user
                t.done = o.optLong("done");
                t.total = o.optLong("total", -1);
                tasks.put(t.id, t);
                if (t.id >= nextId) nextId = t.id + 1;
            }
        } catch (Exception ignored) { }
    }

    private void save() {
        try {
            JSONArray a = new JSONArray();
            for (Task t : tasks.values()) {
                JSONObject o = new JSONObject();
                o.put("id", t.id);
                o.put("url", t.url);
                o.put("name", t.name);
                o.put("sub", t.sub);
                o.put("uri", t.uri);
                o.put("state", t.state);
                o.put("done", t.done);
                o.put("total", t.total);
                a.put(o);
            }
            prefs.edit().putString("tasks", a.toString()).putLong("next", nextId).putInt("parallel", maxParallel).apply();
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ public API (called from the JS bridge)
    synchronized long add(String url, String name, String sub) {
        Task t = new Task();
        t.id = nextId++;
        t.url = url;
        t.name = cleanSeg(name);
        t.sub = cleanPath(sub);
        tasks.put(t.id, t);
        save();
        schedule();
        return t.id;
    }

    synchronized void pause(long id) {
        Task t = tasks.get(id);
        if (t == null) return;
        t.wantResume = false;
        if (t.state == RUNNING && t.dl != null) t.dl.pause();
        else if (t.state == QUEUED) {
            t.state = PAUSED;
            save();
        }
    }

    /** newUrl may be empty. Use it after a pause that was long enough for the link to expire. */
    synchronized void resume(long id, String newUrl) {
        Task t = tasks.get(id);
        if (t == null) return;
        if (newUrl != null && !newUrl.isEmpty()) t.url = newUrl;
        if (t.state == RUNNING && t.dl != null) {      // a pause is still being processed
            t.wantResume = true;
            return;
        }
        if (t.state == PAUSED || t.state == FAILED) {
            t.state = QUEUED;
            t.error = "";
            save();
            schedule();
        }
    }

    synchronized void stop(long id) {
        Task t = tasks.get(id);
        if (t == null) return;
        t.wantResume = false;
        if (t.state == RUNNING && t.dl != null) {
            t.dl.stop();                                // the worker discards the partial data
        } else {
            try {
                sinkFor(t).discard();
            } catch (Exception ignored) { }
            t.sink = null;
            t.uri = "";
            t.done = 0;
            t.state = STOPPED;
            save();
        }
    }

    synchronized void remove(long id) {
        Task t = tasks.get(id);
        if (t == null) return;
        if (t.state == RUNNING && t.dl != null) {
            t.removeAfter = true;
            t.dl.stop();
            return;
        }
        if (t.state != DONE) {
            try {
                sinkFor(t).discard();
            } catch (Exception ignored) { }
        }
        tasks.remove(id);
        save();
        DownloadService.refresh(ctx);
    }

    synchronized void setParallel(int n) {
        maxParallel = Math.max(1, Math.min(8, n));
        save();
        schedule();
    }

    synchronized String status(String idsJson) {
        JSONArray out = new JSONArray();
        try {
            JSONArray ids = new JSONArray(idsJson);
            for (int i = 0; i < ids.length(); i++) {
                Task t = tasks.get(ids.getLong(i));
                if (t == null) continue;
                JSONObject o = new JSONObject();
                o.put("id", t.id);
                o.put("state", t.state);
                o.put("done", t.done);
                o.put("total", t.total);
                o.put("speed", t.speed);
                o.put("error", t.error);
                out.put(o);
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    synchronized Summary summary() {
        Summary s = new Summary();
        for (Task t : tasks.values()) {
            if (t.state == RUNNING) {
                s.active++;
                s.done += t.done;
                if (t.total > 0) s.total += t.total;
                s.speed += t.speed;
                if (s.firstName.isEmpty()) s.firstName = t.name;
            } else if (t.state == QUEUED) {
                s.queued++;
            }
        }
        return s;
    }

    // ------------------------------------------------------------------ scheduling
    private void schedule() {
        int running = 0;
        for (Task t : tasks.values()) if (t.state == RUNNING) running++;
        for (Task t : tasks.values()) {
            if (running >= maxParallel) break;
            if (t.state == QUEUED) {
                startTask(t);
                running++;
            }
        }
    }

    private void startTask(final Task t) {
        t.state = RUNNING;
        t.error = "";
        t.speed = 0;
        t.lastBytes = t.done;
        t.lastTime = SystemClock.elapsedRealtime();
        final ResumableDownload dl = new ResumableDownload(t.url, sinkFor(t), (d, tot) -> onProgress(t, d, tot));
        t.dl = dl;
        DownloadService.start(ctx);
        pool.execute(() -> {
            ResumableDownload.Result r = dl.run();
            finished(t, r, dl.error);
        });
    }

    private void onProgress(Task t, long done, long total) {
        t.done = done;
        t.total = total;
        long now = SystemClock.elapsedRealtime();
        if (now - t.lastTime >= 1000) {
            t.speed = (done - t.lastBytes) * 1000.0 / (now - t.lastTime);
            t.lastBytes = done;
            t.lastTime = now;
        }
        if (t.uri.isEmpty() && t.sink instanceof MediaStoreSink) {      // remember the entry so we can resume later
            syncUri(t);
            synchronized (this) {
                save();
            }
        }
        if (now - lastRefresh > 1500) {
            lastRefresh = now;
            DownloadService.refresh(ctx);
        }
    }

    private synchronized void finished(Task t, ResumableDownload.Result r, String err) {
        t.dl = null;
        t.speed = 0;
        syncUri(t);
        switch (r) {
            case DONE:
                t.state = DONE;
                if (t.total > 0) t.done = t.total;
                t.sink = null;
                t.uri = "";
                DownloadService.notifyDone(ctx, t.name);
                break;
            case PAUSED:
                if (t.wantResume) {
                    t.wantResume = false;
                    t.state = QUEUED;
                } else {
                    t.state = PAUSED;
                }
                break;
            case STOPPED:
                t.state = STOPPED;
                t.done = 0;
                t.sink = null;
                t.uri = "";
                if (t.removeAfter) tasks.remove(t.id);
                break;
            default:
                t.state = FAILED;
                t.error = err == null ? "Download failed" : err;
                break;
        }
        save();
        schedule();
        DownloadService.refresh(ctx);
    }
}
