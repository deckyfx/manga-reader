using System;
using System.IO;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using SkiaSharp;
using MangaReaderDesktop.ViewModels;
using MangaReaderDesktop.Views;

namespace MangaReaderDesktop;

public partial class App : Application
{
    private MainViewModel?            _vm;
    private MainWindow?               _mainWindow;
    private OverlayWindow?            _selectionOverlay;
    private TranslationOverlayWindow? _translationOverlay;
    private TrayIcon?                 _trayIcon;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is not IClassicDesktopStyleApplicationLifetime desktop)
        {
            base.OnFrameworkInitializationCompleted();
            return;
        }

        _vm               = new MainViewModel();
        _mainWindow       = new MainWindow { DataContext = _vm };
        _selectionOverlay = new OverlayWindow();

        // ── Capture flow event wiring ────────────────────────────────────
        _vm.CaptureRequested   += OnCaptureRequested;
        _vm.SelectionRequested += OnSelectionRequested;
        _vm.ResultReady        += OnResultReady;

        _vm.OverlayUpdateRequested += (text) =>
            Dispatcher.UIThread.Post(() => HandleTranslationOverlay(text));

        _selectionOverlay.RegionSelected += async (x, y, w, h) =>
            await _vm.OnRegionSelectedAsync(x, y, w, h);

        _selectionOverlay.Cancelled += () =>
        {
            _vm.CancelCapture();
            Dispatcher.UIThread.Post(() =>
            {
                _mainWindow.Show();
                _mainWindow.Activate();
            });
        };

        // ── Tray icon ────────────────────────────────────────────────────
        SetupTrayIcon(desktop);

        // ── Show main window on startup — centered ───────────────────────
        _mainWindow.Show();
        _mainWindow.PositionCentered();

        // Do NOT set desktop.MainWindow — we manage lifetime ourselves.
        base.OnFrameworkInitializationCompleted();
    }

    // ── Capture flow ─────────────────────────────────────────────────────────

    private async void OnCaptureRequested()
    {
        _mainWindow?.Hide();
        await Task.Delay(200); // Let the window fully hide before screenshot

        try
        {
            var capture = new Services.ScreenCaptureService();
            var png = await capture.CaptureAsync();
            await _vm!.OnScreenshotReadyAsync(png);
        }
        catch (Exception ex)
        {
            _vm!.ErrorMessage = ex.Message;
            _vm.Status = AppStatus.Error;
            Dispatcher.UIThread.Post(() =>
            {
                _mainWindow?.Show();
                _mainWindow?.Activate();
            });
        }
    }

    private void OnSelectionRequested()
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (_vm?.ScreenshotBitmap is { } bmp)
                _selectionOverlay?.ShowWithScreenshot(bmp);
        });
    }

    private void OnResultReady()
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (_mainWindow is null) return;
            _mainWindow.Show();
            _mainWindow.PositionNearTray();
            _mainWindow.Activate();
        });
    }

    // ── Translation overlay ───────────────────────────────────────────────────

    private void HandleTranslationOverlay(string? text)
    {
        if (text is null || !(_vm?.Settings.ShowOverlay == true) || _vm.LastRegion is null)
        {
            _translationOverlay?.Hide();
            return;
        }

        if (_translationOverlay is null)
            _translationOverlay = new TranslationOverlayWindow();

        _translationOverlay.SetRegion(_vm.LastRegion.Value);
        _translationOverlay.SetTranslation(text);

        if (!_translationOverlay.IsVisible)
            _translationOverlay.Show();
    }

    // ── Tray icon setup ───────────────────────────────────────────────────────

    private void SetupTrayIcon(IClassicDesktopStyleApplicationLifetime desktop)
    {
        var menu = new NativeMenu();

        var showItem = new NativeMenuItem("Show Window");
        showItem.Click += (_, _) => Dispatcher.UIThread.Post(() =>
        {
            _mainWindow?.Show();
            _mainWindow?.Activate();
        });
        menu.Items.Add(showItem);

        var captureItem = new NativeMenuItem("Capture (Super+Shift+O)");
        captureItem.Click += (_, _) =>
            Dispatcher.UIThread.Post(() => _vm?.StartCaptureCommand.Execute(null));
        menu.Items.Add(captureItem);

        menu.Items.Add(new NativeMenuItemSeparator());

        var settingsItem = new NativeMenuItem("Settings");
        settingsItem.Click += (_, _) => Dispatcher.UIThread.Post(() =>
        {
            if (_vm is null || _mainWindow is null) return;
            _mainWindow.Show();
            _mainWindow.Activate();
            var win = new SettingsWindow();
            win.LoadSettings(_vm.Settings);
            win.SettingsSaved += s => _vm.SaveSettings(s);
            win.ShowDialog(_mainWindow);
        });
        menu.Items.Add(settingsItem);

        menu.Items.Add(new NativeMenuItemSeparator());

        var quitItem = new NativeMenuItem("Quit");
        quitItem.Click += (_, _) =>
        {
            _translationOverlay?.Close();
            _trayIcon?.Dispose();
            _vm?.Dispose();
            desktop.Shutdown();
        };
        menu.Items.Add(quitItem);

        _trayIcon = new TrayIcon
        {
            ToolTipText = "Manga Reader",
            Menu        = menu,
            IsVisible   = true,
            Icon        = CreateTrayIcon(),
        };

        _trayIcon.Clicked += (_, _) => Dispatcher.UIThread.Post(() =>
        {
            _mainWindow?.Show();
            _mainWindow?.Activate();
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static WindowIcon CreateTrayIcon()
    {
        const int size = 16;
        var info = new SKImageInfo(size, size, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var bitmap = new SKBitmap(info);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColors.Transparent);

        using var paint = new SKPaint { Color = new SKColor(137, 180, 250), IsAntialias = true };
        canvas.DrawCircle(7.5f, 7.5f, 6f, paint);

        using var skImage = SKImage.FromBitmap(bitmap);
        using var data    = skImage.Encode(SKEncodedImageFormat.Png, 100);
        using var ms      = new MemoryStream(data.ToArray());
        return new WindowIcon(ms);
    }
}
