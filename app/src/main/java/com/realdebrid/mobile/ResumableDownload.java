package com.realdebrid.mobile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Resumable HTTP download with pause / resume / stop.
 * Pure Java (no Android classes) so it can be tested on a computer.
 *
 * run() blocks until the download is finished, paused, stopped or has failed for good.
 * A paused download keeps its partial data in the Sink; call run() again on a new instance to continue
 * (it asks the server for the missing part with an HTTP Range request).
 */
final class ResumableDownload {

    static final int RUN = 0, PAUSE = 1, STOP = 2;

    enum Result { DONE, PAUSED, STOPPED, FAILED }

    /** Where the bytes go (a file, or a MediaStore entry on Android 10+). */
    interface Sink {
        /** Bytes already stored (the resume point). */
        long size() throws IOException;

        /** Opens the sink positioned at offset; anything stored after offset is dropped. */
        OutputStream open(long offset) throws IOException;

        /** The download is complete. */
        void finish() throws IOException;

        /** Throw the partial data away. */
        void discard();
    }

    interface Progress {
        void onProgress(long done, long total);
    }

    static final class HttpStatus extends IOException {
        final int code;

        HttpStatus(int code) {
            super("HTTP " + code);
            this.code = code;
        }
    }

    private final String url;
    private final Sink sink;
    private final Progress progress;
    private volatile int command = RUN;
    private volatile HttpURLConnection conn;
    private boolean gotData = false;

    volatile String error = "";
    volatile long total = -1;

    ResumableDownload(String url, Sink sink, Progress progress) {
        this.url = url;
        this.sink = sink;
        this.progress = progress;
    }

    void pause() {
        command = PAUSE;
        abort();
    }

    void stop() {
        command = STOP;
        abort();
    }

    private void abort() {
        HttpURLConnection c = conn;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) { }
        }
    }

    private Result checkCommand() {
        if (command == STOP) {
            sink.discard();
            return Result.STOPPED;
        }
        if (command == PAUSE) return Result.PAUSED;
        return null;
    }

    private static boolean permanent(int code) {
        return code == 400 || code == 401 || code == 403 || code == 404 || code == 410;
    }

    Result run() {
        int failures = 0;
        while (true) {
            Result early = checkCommand();
            if (early != null) return early;
            try {
                Result r = attempt();
                if (r != null) return r;
            } catch (IOException e) {
                Result c = checkCommand();
                if (c != null) return c;
                if (e instanceof HttpStatus && permanent(((HttpStatus) e).code)) {
                    error = "The link expired or is not allowed (" + e.getMessage() + "). Tap Retry to make a fresh link.";
                    return Result.FAILED;
                }
                if (gotData) {          // we made progress since the last failure: start counting again
                    failures = 0;
                    gotData = false;
                }
                failures++;
                error = e.getMessage() == null ? e.toString() : e.getMessage();
                if (failures > 8) return Result.FAILED;
                long wait = Math.min(15000L, 1500L * failures);     // wait, then continue from the saved bytes
                for (long t = 0; t < wait; t += 200) {
                    c = checkCommand();
                    if (c != null) return c;
                    try {
                        Thread.sleep(200);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return Result.PAUSED;
                    }
                }
            }
        }
    }

    private static long totalFromRange(String contentRange) {
        // "bytes 100-999/1000"
        if (contentRange == null) return -1;
        int slash = contentRange.lastIndexOf('/');
        if (slash < 0) return -1;
        try {
            return Long.parseLong(contentRange.substring(slash + 1).trim());
        } catch (Exception e) {
            return -1;
        }
    }

    /** One connection. Returns a final result, or throws IOException when a retry is needed. */
    private Result attempt() throws IOException {
        long have = sink.size();
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        conn = c;
        InputStream in = null;
        OutputStream out = null;
        try {
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) RealDebridMobile");
            c.setRequestProperty("Accept-Encoding", "identity");
            if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
            int code = c.getResponseCode();
            Result cmd = checkCommand();
            if (cmd != null) return cmd;
            if (code == 416) {
                long t = totalFromRange(c.getHeaderField("Content-Range"));
                if (t > 0 && have >= t) {           // everything was already downloaded
                    total = t;
                    sink.finish();
                    return Result.DONE;
                }
                sink.open(0).close();               // our partial data does not fit the file: start again
                throw new IOException("Restarting the download");
            }
            if (code >= 400) throw new HttpStatus(code);

            long offset;
            if (code == 206 && have > 0) {          // the server continues where we stopped
                offset = have;
                long t = totalFromRange(c.getHeaderField("Content-Range"));
                long len = c.getContentLengthLong();
                total = t > 0 ? t : (len >= 0 ? have + len : -1);
            } else {                                // 200: the whole file again (no Range support)
                offset = 0;
                total = c.getContentLengthLong();
            }
            in = c.getInputStream();
            out = sink.open(offset);
            byte[] buf = new byte[65536];
            long done = offset;
            boolean eof = false;
            progress.onProgress(done, total);
            while (true) {
                if (command != RUN) break;
                int n = in.read(buf);
                if (n < 0) {
                    eof = true;
                    break;
                }
                out.write(buf, 0, n);
                done += n;
                gotData = true;
                progress.onProgress(done, total);
            }
            out.flush();
            out.close();
            out = null;
            if (!eof) return checkCommand();        // interrupted by pause or stop
            if (total > 0 && done < total) throw new IOException("The connection closed early");
            sink.finish();
            return Result.DONE;
        } finally {
            try {
                if (out != null) out.close();
            } catch (IOException ignored) { }
            try {
                if (in != null) in.close();
            } catch (IOException ignored) { }
            c.disconnect();
            conn = null;
        }
    }
}
