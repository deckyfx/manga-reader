using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using Avalonia;
using Avalonia.Input.Platform;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using MangaReaderDesktop.Models;
using MangaReaderDesktop.Services;

namespace MangaReaderDesktop.ViewModels;

public enum AppStatus { Idle, Capturing, Selecting, Analyzing, Error }

public class MainViewModel : INotifyPropertyChanged, IDisposable
{
    // ── INotifyPropertyChanged ────────────────────────────────────────────────
    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private bool SetProperty<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(name);
        return true;
    }

    // ── Services ──────────────────────────────────────────────────────────────
    private readonly ScreenCaptureService    _capture   = new();
    private readonly HotkeyService           _hotkey    = new();
    private readonly LocalTesseractService   _tesseract = new();
    public  readonly ServerClient            Server;
    public  AppSettings Settings { get; private set; }

    // ── Observable properties ─────────────────────────────────────────────────
    private AppStatus         _status = AppStatus.Idle;
    private string?           _errorMessage;
    private Bitmap?           _screenshotBitmap;
    private string?           _ocrText;
    private string?           _translation;
    private long              _elapsedMs;
    private List<TokenInfo>   _tokens      = [];
    private List<Definition?> _definitions = [];
    private string?           _tesseractStatus;
    private double            _tesseractProgress;

    private PixelRect? _lastRegion;
    private bool       _isContinuousMode;
    private bool       _pendingContinuousMode;
    private CancellationTokenSource? _continuousCts;

    public AppStatus Status
    {
        get => _status;
        set { if (SetProperty(ref _status, value)) OnPropertyChanged(nameof(StatusText)); }
    }

    public string? ErrorMessage     { get => _errorMessage;     set => SetProperty(ref _errorMessage,     value); }
    public Bitmap? ScreenshotBitmap { get => _screenshotBitmap; set => SetProperty(ref _screenshotBitmap, value); }
    public string? OcrText          { get => _ocrText;          set => SetProperty(ref _ocrText,          value); }
    public string? Translation      { get => _translation;      set => SetProperty(ref _translation,      value); }
    public long    ElapsedMs        { get => _elapsedMs;        set => SetProperty(ref _elapsedMs,        value); }

    public string? TesseractStatus
    {
        get => _tesseractStatus;
        set
        {
            if (SetProperty(ref _tesseractStatus, value))
            {
                OnPropertyChanged(nameof(IsDownloading));
                OnPropertyChanged(nameof(StatusText));
            }
        }
    }
    public double TesseractProgress { get => _tesseractProgress; set => SetProperty(ref _tesseractProgress, value); }
    public bool   IsDownloading     => _tesseractStatus is not null;

    public List<TokenInfo> Tokens
    {
        get => _tokens;
        set { if (SetProperty(ref _tokens, value)) OnPropertyChanged(nameof(TokenCards)); }
    }

    public List<Definition?> Definitions
    {
        get => _definitions;
        set { if (SetProperty(ref _definitions, value)) OnPropertyChanged(nameof(TokenCards)); }
    }

    public PixelRect? LastRegion
    {
        get => _lastRegion;
        set => SetProperty(ref _lastRegion, value);
    }

    public bool IsContinuousMode
    {
        get => _isContinuousMode;
        set
        {
            if (SetProperty(ref _isContinuousMode, value))
                OnPropertyChanged(nameof(ContinuousButtonText));
        }
    }

    public string ContinuousButtonText
    {
        get
        {
            if (IsContinuousMode)       return "⏹ Stop";
            if (_pendingContinuousMode) return "⏳ Select…";
            return "⟳ Continuous";
        }
    }

    public string StatusText => _tesseractStatus is not null ? _tesseractStatus : Status switch
    {
        AppStatus.Idle      => Settings.OcrMode == "tesseract"
                                   ? "Press Super+Shift+O to capture  ·  🧩 Tesseract"
                                   : "Press Super+Shift+O to capture",
        AppStatus.Capturing => "Capturing screen…",
        AppStatus.Selecting => "Drag to select a region",
        AppStatus.Analyzing => "Analyzing…",
        AppStatus.Error     => ErrorMessage ?? "Error",
        _                   => ""
    };

    public bool HasResults => OcrText is { Length: > 0 };

    public List<TokenCardModel> TokenCards =>
        Tokens.Select((t, i) => new TokenCardModel(t, i < Definitions.Count ? Definitions[i] : null))
              .Where(c => c.Token.Pos is not ("助詞" or "助動詞" or "記号" or "接続詞" or "感動詞"))
              .ToList();

    // Raw PNG bytes for cropping (not bound to UI)
    public byte[]? ScreenshotPng { get; private set; }

    // ── Commands ──────────────────────────────────────────────────────────────
    public ICommand StartCaptureCommand         { get; }
    public ICommand ToggleContinuousModeCommand { get; }
    public ICommand CopyOcrTextCommand          { get; }
    public ICommand ClearResultsCommand         { get; }
    public ICommand ReScanCommand               { get; }

    public MainViewModel()
    {
        Settings = SettingsStore.Load();
        Server   = new ServerClient(Settings);

        StartCaptureCommand         = new DelegateCommand(async () => await StartCaptureAsync());
        ToggleContinuousModeCommand = new DelegateCommand(ToggleContinuousMode);
        CopyOcrTextCommand          = new DelegateCommand(async () => await CopyOcrTextAsync());
        ClearResultsCommand         = new DelegateCommand(ClearResults);
        ReScanCommand               = new DelegateCommand(async () => { ClearResults(); await StartCaptureAsync(); });

        _hotkey.HotkeyFired += () =>
            Dispatcher.UIThread.Post(() => _ = StartCaptureAsync());

        _hotkey.Start();
    }

    // ── One-shot capture flow ─────────────────────────────────────────────────

    public async Task StartCaptureAsync()
    {
        if (Status is AppStatus.Capturing or AppStatus.Selecting or AppStatus.Analyzing) return;

        // Stop any running continuous scan (but preserve _pendingContinuousMode)
        if (IsContinuousMode)
        {
            _continuousCts?.Cancel();
            _continuousCts = null;
            IsContinuousMode = false;
            OverlayUpdateRequested?.Invoke(null);
        }

        Status = AppStatus.Capturing;
        CaptureRequested?.Invoke();
    }

    public async Task OnScreenshotReadyAsync(byte[] png)
    {
        ScreenshotPng = png;

        using var ms = new System.IO.MemoryStream(png);
        ScreenshotBitmap = new Bitmap(ms);

        Status = AppStatus.Selecting;
        SelectionRequested?.Invoke();
    }

    public async Task OnRegionSelectedAsync(int x, int y, int w, int h)
    {
        if (ScreenshotPng is null) return;

        LastRegion = new PixelRect(x, y, w, h);
        Status     = AppStatus.Analyzing;

        try
        {
            var cropped = _capture.CropPng(ScreenshotPng, x, y, w, h);

            if (Settings.OcrMode == "tesseract")
            {
                var progress = new Progress<(string status, double pct)>(r =>
                    Dispatcher.UIThread.Post(() =>
                    {
                        TesseractStatus   = r.status;
                        TesseractProgress = r.pct;
                    }));

                var text = await _tesseract.OcrAsync(
                    cropped, Settings.TesseractLang, Settings.TesseractQuality, progress);

                TesseractStatus   = null;
                TesseractProgress = 0;
                OcrText     = text;
                Translation = null;
                ElapsedMs   = 0;
                Tokens      = [];
                Definitions = [];
            }
            else
            {
                var base64 = Convert.ToBase64String(cropped);
                var ocr    = await Server.OcrAsync(base64, Settings.TranslateEngine);
                OcrText     = ocr.Text;
                Translation = ocr.Translation;
                ElapsedMs   = ocr.ElapsedMs;

                if (!string.IsNullOrWhiteSpace(ocr.Text))
                {
                    var analyze = await Server.AnalyzeAsync(ocr.Text, mode: Settings.DictionaryMode);
                    Tokens      = analyze.Tokens;
                    Definitions = analyze.Definitions;
                    ElapsedMs   = analyze.ElapsedMs;
                }
                else
                {
                    Tokens      = [];
                    Definitions = [];
                }
            }

            OnPropertyChanged(nameof(HasResults));
            Status = AppStatus.Idle;
            ResultReady?.Invoke();

            if (_pendingContinuousMode)
            {
                _pendingContinuousMode = false;
                OnPropertyChanged(nameof(ContinuousButtonText));
                StartContinuousLoop();
            }
        }
        catch (Exception ex)
        {
            TesseractStatus        = null;
            TesseractProgress      = 0;
            _pendingContinuousMode = false;
            OnPropertyChanged(nameof(ContinuousButtonText));
            ErrorMessage = ex.Message;
            Status = AppStatus.Error;
            ResultReady?.Invoke();
        }
    }

    public void CancelCapture()
    {
        _pendingContinuousMode = false;
        OnPropertyChanged(nameof(ContinuousButtonText));
        ScreenshotPng    = null;
        ScreenshotBitmap = null;
        Status = AppStatus.Idle;
    }

    // ── Continuous mode ───────────────────────────────────────────────────────

    private void ToggleContinuousMode()
    {
        if (IsContinuousMode || _pendingContinuousMode)
        {
            StopContinuousLoop();
            _pendingContinuousMode = false;
            OnPropertyChanged(nameof(ContinuousButtonText));
        }
        else
        {
            if (LastRegion is null)
            {
                // No region yet — capture first, auto-start continuous after region is selected
                _pendingContinuousMode = true;
                OnPropertyChanged(nameof(ContinuousButtonText));
                _ = StartCaptureAsync();
            }
            else
            {
                StartContinuousLoop();
            }
        }
    }

    private void StartContinuousLoop()
    {
        if (IsContinuousMode || LastRegion is null) return;
        IsContinuousMode = true;
        _continuousCts   = new CancellationTokenSource();
        _ = RunContinuousLoopAsync(_continuousCts.Token);
    }

    private void StopContinuousLoop()
    {
        _continuousCts?.Cancel();
        _continuousCts   = null;
        IsContinuousMode = false;
        OverlayUpdateRequested?.Invoke(null);
    }

    private async Task RunContinuousLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ScanRegionAsync(LastRegion!.Value, ct);
                var interval = TimeSpan.FromSeconds(Math.Max(1, Settings.ScanIntervalSeconds));
                await Task.Delay(interval, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                await Dispatcher.UIThread.InvokeAsync(() =>
                {
                    ErrorMessage = $"Continuous scan error: {ex.Message}";
                    Status = AppStatus.Error;
                });
                // Keep looping — transient errors shouldn't stop continuous mode
                await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, Settings.ScanIntervalSeconds)), ct)
                          .ConfigureAwait(false);
            }
        }
    }

    private async Task ScanRegionAsync(PixelRect region, CancellationToken ct)
    {
        var png = await _capture.CaptureAsync();
        ct.ThrowIfCancellationRequested();

        var cropped = _capture.CropPng(png, region.X, region.Y, region.Width, region.Height);

        if (Settings.OcrMode == "tesseract")
        {
            // Local OCR — no translation or token analysis
            var text = await _tesseract.OcrAsync(
                cropped, Settings.TesseractLang, Settings.TesseractQuality, null, ct);
            ct.ThrowIfCancellationRequested();

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                OcrText     = text;
                Translation = null;
                ElapsedMs   = 0;
                Tokens      = [];
                Definitions = [];
                OnPropertyChanged(nameof(HasResults));
                Status = AppStatus.Idle;
            });
        }
        else
        {
            var base64 = Convert.ToBase64String(cropped);
            var ocr    = await Server.OcrAsync(base64, Settings.TranslateEngine);
            ct.ThrowIfCancellationRequested();

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                OcrText     = ocr.Text;
                Translation = ocr.Translation;
                ElapsedMs   = ocr.ElapsedMs;
                OnPropertyChanged(nameof(HasResults));
                Status = AppStatus.Idle;

                if (Settings.ShowOverlay)
                    OverlayUpdateRequested?.Invoke(Translation);
            });

            if (!string.IsNullOrWhiteSpace(ocr.Text))
            {
                var analyze = await Server.AnalyzeAsync(ocr.Text, mode: Settings.DictionaryMode);
                ct.ThrowIfCancellationRequested();

                await Dispatcher.UIThread.InvokeAsync(() =>
                {
                    Tokens      = analyze.Tokens;
                    Definitions = analyze.Definitions;
                    ElapsedMs   = analyze.ElapsedMs;
                });
            }
            else
            {
                await Dispatcher.UIThread.InvokeAsync(() =>
                {
                    Tokens      = [];
                    Definitions = [];
                    ElapsedMs   = 0;
                });
            }
        }
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    public async Task CopyOcrTextAsync()
    {
        if (OcrText is null) return;
        var clipboard = Avalonia.Application.Current?.ApplicationLifetime is
            Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime { MainWindow: { } w }
            ? w.Clipboard
            : null;
        if (clipboard is not null)
            await clipboard.SetTextAsync(OcrText);
    }

    public void ClearResults()
    {
        StopContinuousLoop();
        _pendingContinuousMode = false;
        OnPropertyChanged(nameof(ContinuousButtonText));

        OcrText          = null;
        Translation      = null;
        Tokens           = [];
        Definitions      = [];
        ScreenshotBitmap = null;
        ScreenshotPng    = null;
        ErrorMessage     = null;
        Status           = AppStatus.Idle;
        OnPropertyChanged(nameof(HasResults));
    }

    public void SaveSettings(AppSettings settings)
    {
        Settings = settings;
        if (!SettingsStore.Save(settings))
        {
            ErrorMessage = $"Settings not saved: {SettingsStore.LastSaveError}";
            Status = AppStatus.Error;
        }
        Server.Reinitialize(settings);

        // Hide overlay if it was just disabled
        if (!settings.ShowOverlay)
            OverlayUpdateRequested?.Invoke(null);
    }

    // ── Events for the App shell ──────────────────────────────────────────────
    public event Action?        CaptureRequested;
    public event Action?        SelectionRequested;
    public event Action?        ResultReady;
    /// <summary>Fired to show/update the translation overlay. null = hide overlay.</summary>
    public event Action<string?>? OverlayUpdateRequested;

    public void Dispose()
    {
        StopContinuousLoop();
        _hotkey.Dispose();
        _tesseract.Dispose();
        Server.Dispose();
    }
}
