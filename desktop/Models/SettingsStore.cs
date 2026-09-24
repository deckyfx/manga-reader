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
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "web-ocr-desktop",
        "settings.json");

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

            return base_ with { ApiKey = LoadApiKey() };
        }
        catch
        {
            // Corrupted or missing settings.json — still try to load stored API key.
            return new AppSettings() with { ApiKey = LoadApiKey() };
        }
    }

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
