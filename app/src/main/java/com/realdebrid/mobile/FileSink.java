package com.realdebrid.mobile;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;

/** Stores a download in a plain file ("name.part" until it is complete). Pure Java. */
final class FileSink implements ResumableDownload.Sink {
    private final File target;
    private final File part;
    private File finalFile;

    FileSink(File target) {
        this.target = target;
        this.part = new File(target.getPath() + ".part");
    }

    File finalFile() {
        return finalFile;
    }

    @Override
    public long size() {
        return part.exists() ? part.length() : 0;
    }

    @Override
    public OutputStream open(long offset) throws IOException {
        File dir = part.getParentFile();
        if (dir != null) dir.mkdirs();
        final RandomAccessFile raf = new RandomAccessFile(part, "rw");
        raf.setLength(offset);          // drop anything after the resume point
        raf.seek(offset);
        return new OutputStream() {
            @Override
            public void write(int b) throws IOException {
                raf.write(b);
            }

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                raf.write(b, off, len);
            }

            @Override
            public void close() throws IOException {
                raf.close();
            }
        };
    }

    @Override
    public void finish() throws IOException {
        File dest = target;
        if (dest.exists()) {            // never overwrite: "name (1).ext"
            String n = target.getName();
            int dot = n.lastIndexOf('.');
            String base = dot > 0 ? n.substring(0, dot) : n;
            String ext = dot > 0 ? n.substring(dot) : "";
            int i = 1;
            do {
                dest = new File(target.getParentFile(), base + " (" + i++ + ")" + ext);
            } while (dest.exists());
        }
        if (!part.renameTo(dest)) throw new IOException("Cannot save the file");
        finalFile = dest;
    }

    @Override
    public void discard() {
        part.delete();
    }
}
