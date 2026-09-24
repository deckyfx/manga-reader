using System;
using System.Threading;
using System.Threading.Tasks;
using SharpHook;
using SharpHook.Data;

namespace MangaReaderDesktop.Services;

/// <summary>
/// Listens for Super+Shift+O globally using SharpHook (libUIOHook).
/// Call StartAsync() once; Dispose() to clean up.
/// </summary>
public sealed class HotkeyService : IDisposable
{
    public event Action? HotkeyFired;

    private readonly TaskPoolGlobalHook _hook = new();
    private CancellationTokenSource? _cts;

    // Track modifier state manually since mask may not include them reliably on all platforms
    private bool _superHeld;
    private bool _shiftHeld;

    public void Start()
    {
        _hook.KeyPressed  += OnKeyPressed;
        _hook.KeyReleased += OnKeyReleased;

        _cts = new CancellationTokenSource();
        Task.Run(async () =>
        {
            try { await _hook.RunAsync(); }
            catch (OperationCanceledException) { }
        });
    }

    private void OnKeyPressed(object? sender, KeyboardHookEventArgs e)
    {
        switch (e.Data.KeyCode)
        {
            case KeyCode.VcLeftMeta:
            case KeyCode.VcRightMeta:
                _superHeld = true;
                break;
            case KeyCode.VcLeftShift:
            case KeyCode.VcRightShift:
                _shiftHeld = true;
                break;
            case KeyCode.VcO:
                if (_superHeld && _shiftHeld)
                    HotkeyFired?.Invoke();
                break;
        }
    }

    private void OnKeyReleased(object? sender, KeyboardHookEventArgs e)
    {
        switch (e.Data.KeyCode)
        {
            case KeyCode.VcLeftMeta:
            case KeyCode.VcRightMeta:
                _superHeld = false;
                break;
            case KeyCode.VcLeftShift:
            case KeyCode.VcRightShift:
                _shiftHeld = false;
                break;
        }
    }

    public void Dispose()
    {
        _hook.KeyPressed  -= OnKeyPressed;
        _hook.KeyReleased -= OnKeyReleased;
        _hook.Dispose();
        _cts?.Cancel();
        _cts?.Dispose();
    }
}
