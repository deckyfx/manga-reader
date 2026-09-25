using System;
using System.Windows.Input;

namespace MangaReaderDesktop.ViewModels;

/// <summary>Minimal synchronous ICommand — no external dependencies.</summary>
public sealed class DelegateCommand : ICommand
{
    private readonly Action    _execute;
    private readonly Func<bool>? _canExecute;

    public DelegateCommand(Action execute, Func<bool>? canExecute = null)
    {
        _execute    = execute;
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? _) => _canExecute?.Invoke() ?? true;
    public void Execute(object? _)    => _execute();
    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
