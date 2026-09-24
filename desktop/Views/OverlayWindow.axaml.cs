using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using MangaReaderDesktop.ViewModels;

namespace MangaReaderDesktop.Views;

public partial class OverlayWindow : Window
{
    private OverlayViewModel? _vm;
    private bool   _dragging;
    private double _screenScale = 1.0; // physical pixels per DIP, used for crop coordinate conversion

    public event Action<int, int, int, int>? RegionSelected;
    public event Action? Cancelled;

    public OverlayWindow()
    {
        InitializeComponent();
    }

    public void ShowWithScreenshot(Bitmap screenshot)
    {
        // screen.Bounds is in physical pixels; Window.Width/Height are in DIPs.
        // Dividing by Scaling converts physical → DIP so the window fits exactly.
        var screen   = Screens.Primary;
        _screenScale = screen?.Scaling ?? 1.0;
        double dipW  = (screen?.Bounds.Width  ?? screenshot.PixelSize.Width)  / _screenScale;
        double dipH  = (screen?.Bounds.Height ?? screenshot.PixelSize.Height) / _screenScale;

        _vm = new OverlayViewModel { CanvasWidth = dipW, CanvasHeight = dipH, ScreenScale = _screenScale };
        DataContext = _vm;
        ScreenshotImage.Source = screenshot;
        _vm.Reset();

        if (screen is not null)
            Position = new PixelPoint(screen.Bounds.X, screen.Bounds.Y);

        Width  = dipW;
        Height = dipH;
        WindowState = WindowState.FullScreen;
        Show();
        Activate();
        Focus();
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (e.GetCurrentPoint(OverlayCanvas).Properties.IsLeftButtonPressed)
        {
            _dragging = true;
            e.Pointer.Capture(OverlayCanvas);
            _vm?.BeginSelection(e.GetPosition(OverlayCanvas));
        }
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_dragging) _vm?.UpdateSelection(e.GetPosition(OverlayCanvas));
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (!_dragging) return;
        _dragging = false;
        e.Pointer.Capture(null);

        _vm?.EndSelection(e.GetPosition(OverlayCanvas));

        if (_vm?.HasValidSelection == true)
        {
            var r = _vm.SelectionRect;

            // Pointer events are in DIPs; crop coordinates must be physical pixels.
            // _screenScale = physical pixels per DIP (e.g. 1.5 at 150 % display scaling).
            int x = (int)(r.X      * _screenScale);
            int y = (int)(r.Y      * _screenScale);
            int w = (int)(r.Width  * _screenScale);
            int h = (int)(r.Height * _screenScale);

            Hide();
            RegionSelected?.Invoke(x, y, w, h);
        }
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        if (!_dragging) return;
        _dragging = false;
        _vm?.Reset(); // treat lost capture the same as Escape — cancel the selection
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key == Key.Escape)
        {
            _dragging = false;
            _vm?.Reset();
            Hide();
            Cancelled?.Invoke();
        }
    }
}
