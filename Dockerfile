# Dockerfile for manga-ocr
# Uses pre-built base image with manga-ocr and torch
FROM comic-reader-base:latest

# Copy requirements file first (for additional dependencies if needed)
COPY requirements.txt .

# Install any additional dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"]
