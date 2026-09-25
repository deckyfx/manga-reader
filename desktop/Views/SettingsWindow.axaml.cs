using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Interactivity;
using MangaReaderDesktop.Models;
using MangaReaderDesktop.Services;
using MangaReaderDesktop.ViewModels;

namespace MangaReaderDesktop.Views;

public partial class SettingsWindow : Window
{
    public static readonly string[] DictionaryModes   = ["local", "jisho"];
    public static readonly string[] TesseractLangs    = ["jpn", "jpn_vert", "eng", "chi_sim", "chi_tra", "kor"];
    public static readonly string[] TesseractQualities = ["fast", "best"];

    public event Action<AppSettings>? SettingsSaved;

    public SettingsWindow()
    {
        InitializeComponent();
    }

    public void LoadSettings(AppSettings settings)
    {
        DataContext = new SettingsViewModel(settings);
        UpdateTabStyles();
    }

    private void OnServerTabClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not SettingsViewModel vm) return;
        vm.OcrMode = "server";
        UpdateTabStyles();
    }

    private void OnTesseractTabClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not SettingsViewModel vm) return;
        vm.OcrMode = "tesseract";
        UpdateTabStyles();
    }

    private void UpdateTabStyles()
    {
        if (DataContext is not SettingsViewModel vm) return;
        var serverBtn = this.FindControl<Button>("ServerTabBtn");
        var tessBtn   = this.FindControl<Button>("TesseractTabBtn");
        if (serverBtn is null || tessBtn is null) return;

        if (vm.IsServerMode)
        {
            serverBtn.Classes.Set("tab-active", true);  serverBtn.Classes.Set("tab", false);
            tessBtn.Classes.Set("tab-active", false);   tessBtn.Classes.Set("tab", true);
        }
        else
        {
            serverBtn.Classes.Set("tab-active", false); serverBtn.Classes.Set("tab", true);
            tessBtn.Classes.Set("tab-active", true);    tessBtn.Classes.Set("tab", false);
        }
    }

    private async void OnTestConnectionClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not SettingsViewModel vm) return;

        vm.IsTestingConnection = true;
        vm.ConnectionStatus    = "";

        try
        {
            var url = vm.ServerUrl.Trim();
            if (!Uri.TryCreate(url, UriKind.Absolute, out var baseUri))
            {
                vm.ConnectionStatus = "✗ Invalid URL";
                return;
            }

            // Redirects are not followed here either: the key must not be walked to another origin.
            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
            {
                Timeout = TimeSpan.FromSeconds(5),
            };

            var held = vm.ApiKey?.Trim();
            var key = ServerAddress.UsableApiKey(vm.ToSettings());
            if (key is not null)
                http.DefaultRequestHeaders.TryAddWithoutValidation("X-Api-Key", key);

            // /health answers anyone, so on its own it cannot tell a good key from a bad one — and OCR and analyze
            // both need a contributor's. Ask /api/whoami as well, or the test passes and the hotkey then fails.
            var health = await http.GetFromJsonAsync<HealthResponse>(new Uri(baseUri, "/health"));
            var version = health?.Version.Server is { Length: > 0 } v ? $" v{v}" : "";

            if (key is null)
            {
                vm.ConnectionStatus = string.IsNullOrWhiteSpace(held)
                    ? $"⚠ Server{version} is up, but no API key is set — OCR will be refused"
                    : $"⚠ Server{version} is up. {ServerAddress.WithheldMessage}";
                return;
            }

            var who = await http.GetAsync(new Uri(baseUri, "/api/whoami"));
            if (who.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
            {
                vm.ConnectionStatus = $"✗ Server{version} is up, but it did not accept this key";
                return;
            }
            who.EnsureSuccessStatusCode();
            var me = await who.Content.ReadFromJsonAsync<WhoAmIResponse>();

            var waiting = health is { UsableHere: false } ? $" — {health.NotReadyReason}" : "";
            vm.ConnectionStatus = me is not null
                ? $"✓ Connected{version} as {me.Username} ({me.Role}){waiting}"
                : $"✓ Connected{version}{waiting}";
        }
        catch (TaskCanceledException)
        {
            vm.ConnectionStatus = "✗ Timed out (5 s)";
        }
        catch (HttpRequestException ex)
        {
            vm.ConnectionStatus = $"✗ {ex.Message}";
        }
        catch (Exception ex)
        {
            vm.ConnectionStatus = $"✗ {ex.GetType().Name}: {ex.Message}";
        }
        finally
        {
            vm.IsTestingConnection = false;
        }
    }

    private async void OnSaveClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not SettingsViewModel vm) return;
        try
        {
            SettingsSaved?.Invoke(vm.ToSettings());
            Close();
        }
        catch (ArgumentException ex)
        {
            var dlg = new Window
            {
                Title         = "Invalid Settings",
                Width         = 360,
                SizeToContent = SizeToContent.Height,
                CanResize     = false,
            };
            var okBtn = new Button
            {
                Content             = "OK",
                HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Right,
                Margin              = new Avalonia.Thickness(16, 0, 16, 16),
            };
            okBtn.Click += (_, _) => dlg.Close();
            dlg.Content = new StackPanel
            {
                Children =
                {
                    new TextBlock
                    {
                        Text         = ex.Message,
                        Margin       = new Avalonia.Thickness(16),
                        TextWrapping = Avalonia.Media.TextWrapping.Wrap,
                    },
                    okBtn,
                }
            };
            await dlg.ShowDialog(this);
        }
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e) => Close();
}
