#!/usr/bin/env python3
"""
Health check script for manga-ocr service

Checks if the Unix socket is accessible and the /health endpoint responds.
"""
import socket
import sys

SOCKET_PATH = "/app/sock/manga-ocr.sock"

try:
    # Create Unix socket connection
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(2)
    sock.connect(SOCKET_PATH)

    # Send HTTP GET request to /health
    request = b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n"
    sock.sendall(request)

    # Receive response
    response = sock.recv(1024)
    sock.close()

    # Check if response contains 200 OK (server is up, models may still be loading)
    if b"200" in response:
        sys.exit(0)  # Success — server is accepting connections
    else:
        print("Health check failed: unexpected response", file=sys.stderr)
        sys.exit(1)

except FileNotFoundError:
    print(f"Health check failed: socket not found at {SOCKET_PATH}", file=sys.stderr)
    sys.exit(1)
except ConnectionRefusedError:
    print("Health check failed: connection refused", file=sys.stderr)
    sys.exit(1)
except socket.timeout:
    print("Health check failed: timeout", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Health check failed: {e}", file=sys.stderr)
    sys.exit(1)
