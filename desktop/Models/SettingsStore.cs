using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MangaReaderDesktop.Models;

public static class SettingsStore
{
    private static readonly string AppData =
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

    private static readonly string Dir = Path.Combine(AppData, "manga-reader-desktop");

    private static readonly string FilePath = Path.Combine(Dir, "settings.json");

    /// <summary>
    /// The folder was called web-ocr-desktop until 2026-09. Carry its contents across on first use — they are the
    /// server address and the API key, and asking for those again is a worse welcome than a moved folder deserves.
    ///
    /// File by file rather than folder by folder: the new folder may already exist and be short of one of them
    /// (a settings file saved before the old one was restored from a backup, say), and moving the folder would
    /// then do nothing at all. Whatever is already here wins if it can be read; a file here that cannot be — an
    /// empty or truncated one, or a key encrypted by a profile this machine cannot decrypt, since %APPDATA% roams
    /// on Windows — is worse than the old copy it would displace, so the old one replaces it. Either way the old
    /// copy goes, and the key is not left lying in two places.
    /// </summary>
    static SettingsStore()
    {
        var legacy = Path.Combine(AppData, "web-ocr-desktop");
        try
        {
            if (!Directory.Exists(legacy)) return;

            foreach (var name in new[] { "settings.json", ".apikey" })
            {
                var from = Path.Combine(legacy, name);
                var to   = Path.Combine(Dir, name);
                if (!File.Exists(from)) continue;

                if (!Readable(to, name))
                {
                    Directory.CreateDirectory(Dir);
                    CopyPrivately(from, to);
                }

                // Only once a whole copy is in place — CopyPrivately throws rather than return half of one.
                File.Delete(from);
            }

            // Only if nothing else of theirs is in there.
            if (!Directory.EnumerateFileSystemEntries(legacy).GetEnumerator().MoveNext())
                Directory.Delete(legacy);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    /// <summary>
    /// Whether the file already in the new folder is worth keeping — which means being able to read it, not merely
    /// finding it there. Keeping an unreadable one would mean deleting a good copy behind it and then asking for
    /// the API key again.
    /// </summary>
    private static bool Readable(string path, string name)
    {
        if (!File.Exists(path)) return false;
        try
        {
            // For the key this is ApiKeyPath, which LoadApiKey reads: null covers empty, malformed, and a blob
            // this machine cannot decrypt.
            if (name == ".apikey") return LoadApiKey() is not null;
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path)) is not null;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Copies a file into place whole or not at all, and never readable by anyone else on the way.
    ///
    /// Both matter here, because the source is deleted afterwards: a copy interrupted half way would otherwise
    /// leave a partial file that the next start mistakes for a finished one, and a plain copy is created with the
    /// umask's permissions — so the key would sit readable for as long as it took to chmod it, and stay that way
    /// if the chmod failed. The bytes go to a temporary file created 0600, which is renamed into place only once
    /// it is complete; a rename within a directory is atomic.
    /// </summary>
    private static void CopyPrivately(string from, string to)
    {
        var tmp = to + ".migrating";
        try
        {
            var options = new FileStreamOptions
            {
                Mode = FileMode.Create,
                Access = FileAccess.Write,
                Share = FileShare.None,
            };
            if (!OperatingSystem.IsWindows())
                options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;

            using (var source = File.OpenRead(from))
            using (var destination = new FileStream(tmp, options))
            {
                source.CopyTo(destination);
                destination.Flush(flushToDisk: true);
            }

            File.Move(tmp, to, overwrite: true);
        }
        catch
        {
            TryDelete(tmp);
            throw;
        }
    }

    // Stored separately so it never appears in settings.json
    private static string ApiKeyPath => Path.Combine(
        Path.GetDirectoryName(FilePath)!, ".apikey");

    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    /// <summary>Non-null when the last Save call failed.</summary>
    public static string? LastSaveError { get; private set; }

    public static AppSettings Load()
    {
        try
        {
            AppSettings base_ = !File.Exists(FilePath)
                ? new AppSettings()
                : JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();

            return Migrate(base_) with { ApiKey = LoadApiKey() };
        }
        catch
        {
            // Corrupted or missing settings.json — still try to load stored API key.
            return new AppSettings() with { ApiKey = LoadApiKey() };
        }
    }

    /// <summary>
    /// A file written before the engine choice moved to the server says which engine it wanted; anything but
    /// "none" meant yes. The old field is dropped once read, so it is not carried along forever.
    /// </summary>
    private static AppSettings Migrate(AppSettings s) =>
        s.LegacyTranslateEngine is { Length: > 0 } engine
            ? s with
            {
                Translate = !engine.Equals("none", StringComparison.OrdinalIgnoreCase),
                LegacyTranslateEngine = null,
            }
            : s;

    /// <returns>true on success; false on failure — check <see cref="LastSaveError"/>.</returns>
    public static bool Save(AppSettings settings)
    {
        var tmpJson   = FilePath   + ".tmp";
        var tmpApiKey = ApiKeyPath + ".tmp";
        try
        {
            LastSaveError = null;
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);

            // Stage both files as .tmp so neither target is partially updated.
            File.WriteAllText(tmpJson, JsonSerializer.Serialize(settings, JsonOpts));

            bool hasKey = !string.IsNullOrEmpty(settings.ApiKey);
            if (hasKey)
            {
                string stored = OperatingSystem.IsWindows()
                    ? EncryptDpapi(settings.ApiKey!)
                    : Convert.ToBase64String(Encoding.UTF8.GetBytes(settings.ApiKey!));
                File.WriteAllText(tmpApiKey, stored);
                if (!OperatingSystem.IsWindows())
                {
                    try { File.SetUnixFileMode(tmpApiKey, UnixFileMode.UserRead | UnixFileMode.UserWrite); }
                    catch { /* chmod 600 best-effort */ }
                }
            }

            // Both writes succeeded — atomically replace the real files.
            File.Move(tmpJson, FilePath, overwrite: true);

            if (hasKey)
                File.Move(tmpApiKey, ApiKeyPath, overwrite: true);
            else if (File.Exists(ApiKeyPath))
                File.Delete(ApiKeyPath);

            return true;
        }
        catch (Exception ex)
        {
            LastSaveError = ex.Message;
            TryDelete(tmpJson);
            TryDelete(tmpApiKey);
            return false;
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    // ── API-key secure storage ────────────────────────────────────────────────

    private static string? LoadApiKey()
    {
        try
        {
            if (!File.Exists(ApiKeyPath)) return null;
            var stored = File.ReadAllText(ApiKeyPath);
            if (string.IsNullOrEmpty(stored)) return null;

            if (OperatingSystem.IsWindows())
                return DecryptDpapi(stored);

            return Encoding.UTF8.GetString(Convert.FromBase64String(stored));
        }
        catch { return null; }
    }

    [SupportedOSPlatform("windows")]
    private static string EncryptDpapi(string plain)
    {
        var bytes     = Encoding.UTF8.GetBytes(plain);
        var encrypted = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(encrypted);
    }

    [SupportedOSPlatform("windows")]
    private static string DecryptDpapi(string stored)
    {
        var bytes     = Convert.FromBase64String(stored);
        var decrypted = ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser);
        return Encoding.UTF8.GetString(decrypted);
    }
}
