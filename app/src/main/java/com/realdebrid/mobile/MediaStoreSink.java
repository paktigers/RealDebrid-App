package com.realdebrid.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.util.Locale;

/**
 * Android 10+: stores the download in the public Downloads folder through MediaStore.
 * The entry stays "pending" (hidden from other apps) until the download is complete, and we can
 * reopen it to continue after a pause.
 */
final class MediaStoreSink implements ResumableDownload.Sink {
    private final ContentResolver cr;
    private final String name;
    private final String relPath;
    private Uri uri;

    MediaStoreSink(Context c, String name, String sub, String uriString) {
        this.cr = c.getContentResolver();
        this.name = name;
        this.relPath = Environment.DIRECTORY_DOWNLOADS + "/RealDebrid/" + (sub == null || sub.isEmpty() ? "" : sub + "/");
        if (uriString != null && !uriString.isEmpty()) uri = Uri.parse(uriString);
    }

    String uriString() {
        return uri == null ? "" : uri.toString();
    }

    @Override
    public long size() {
        if (uri == null) return 0;
        try (ParcelFileDescriptor p = cr.openFileDescriptor(uri, "r")) {
            return p == null ? 0 : p.getStatSize();
        } catch (Exception e) {      // the entry was deleted: start again
            uri = null;
            return 0;
        }
    }

    @Override
    public OutputStream open(long offset) throws IOException {
        if (uri == null) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            String ext = "";
            int dot = name.lastIndexOf('.');
            if (dot >= 0) ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            v.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, relPath);
            v.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("Cannot create the file in Downloads");
        }
        final ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "rw");
        if (pfd == null) throw new IOException("Cannot open the file in Downloads");
        final FileOutputStream fos = new FileOutputStream(pfd.getFileDescriptor());
        final FileChannel ch = fos.getChannel();
        ch.truncate(offset);
        ch.position(offset);
        return new OutputStream() {
            @Override
            public void write(int b) throws IOException {
                fos.write(b);
            }

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                fos.write(b, off, len);
            }

            @Override
            public void flush() throws IOException {
                fos.flush();
            }

            @Override
            public void close() throws IOException {
                try {
                    fos.close();
                } finally {
                    pfd.close();
                }
            }
        };
    }

    @Override
    public void finish() {
        if (uri == null) return;
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.IS_PENDING, 0);
        cr.update(uri, v, null, null);
    }

    @Override
    public void discard() {
        if (uri == null) return;
        try {
            cr.delete(uri, null, null);
        } catch (Exception ignored) { }
        uri = null;
    }
}
