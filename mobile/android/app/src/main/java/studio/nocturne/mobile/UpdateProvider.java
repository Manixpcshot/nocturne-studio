package studio.nocturne.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public final class UpdateProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }

    private File archive(Uri uri) throws FileNotFoundException {
        File file = AppUpdates.get(getContext()).ready();
        if (!"/installer.apk".equals(uri.getPath()) || file == null || !file.isFile()) throw new FileNotFoundException();
        return file;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(archive(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] columns, String selection, String[] args, String order) {
        try {
            File file = archive(uri);
            String[] projection = columns == null ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : columns;
            var cursor = new MatrixCursor(projection, 1);
            var row = cursor.newRow();
            for (String column : projection) {
                row.add(OpenableColumns.DISPLAY_NAME.equals(column) ? "Nocturne-Update.apk"
                        : OpenableColumns.SIZE.equals(column) ? file.length() : null);
            }
            return cursor;
        } catch (FileNotFoundException absent) { return null; }
    }

    @Override public Uri insert(Uri uri, ContentValues content) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues content, String filter, String[] arguments) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String filter, String[] arguments) { throw new UnsupportedOperationException(); }
}
