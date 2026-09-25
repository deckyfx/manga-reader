using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using MangaReaderDesktop.ViewModels;

namespace MangaReaderDesktop.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    protected override void OnDataContextChanged(System.EventArgs e)
    {
        base.OnDataContextChanged(e);

        // Update the Continuous button style when IsContinuousMode changes
        if (DataContext is MainViewModel vm)
            vm.PropertyChanged += OnViewModelPropertyChanged;
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.IsContinuousMode))
            UpdateContinuousButtonStyle();
    }

    private void UpdateContinuousButtonStyle()
    {
        if (DataContext is not MainViewModel vm) return;
        if (this.FindControl<Button>("ContinuousBtn") is not { } btn) return;

        if (vm.IsContinuousMode)
        {
            btn.Classes.Remove("action");
            btn.Classes.Add("action-active");
        }
        else
        {
            btn.Classes.Remove("action-active");
            btn.Classes.Add("action");
        }
    }

    private void OnHideClick(object? sender, RoutedEventArgs e) => Hide();

    private void OnSettingsClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not MainViewModel vm) return;
        var win = new SettingsWindow();
        win.LoadSettings(vm.Settings);
        win.SettingsSaved += s => vm.SaveSettings(s);
        win.ShowDialog(this);
    }

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        // Intercept close — hide to tray instead
        e.Cancel = true;
        Hide();
    }

    /// <summary>Centers the window on the primary screen working area.</summary>
    public void PositionCentered()
    {
        var screen = Screens.Primary;
        if (screen is null) return;
        double scale = screen.Scaling;
        var    wa    = screen.WorkingArea;                              // physical pixels
        double w     = double.IsNaN(Width)  || Width  < 1 ? MinWidth  : Width;   // DIPs
        double h     = double.IsNaN(Height) || Height < 1 ? MinHeight : Height;  // DIPs
        Position = new PixelPoint(
            wa.X + (wa.Width  - (int)(w * scale)) / 2,
            wa.Y + (wa.Height - (int)(h * scale)) / 2);
    }

    /// <summary>Positions the window near the bottom-right of the primary screen (tray area).</summary>
    public void PositionNearTray()
    {
        var screen = Screens.Primary;
        if (screen is null) return;
        double scale = screen.Scaling;
        var    wa    = screen.WorkingArea;                              // physical pixels
        double w     = double.IsNaN(Width)  || Width  < 1 ? MinWidth  : Width;   // DIPs
        double h     = double.IsNaN(Height) || Height < 1 ? MinHeight : Height;  // DIPs
        Position = new PixelPoint(
            wa.X + wa.Width  - (int)(w * scale) - 20,
            wa.Y + wa.Height - (int)(h * scale) - 20);
    }
}
