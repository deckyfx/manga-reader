#!/bin/bash
# Test patch generation via Unix socket with manual control

set -e

SOCKET="./data/sock/manga-ocr.sock"
IMAGE_PATH="./example/01.jpg"
OUTPUT_DIR="test_patches"

echo "🧪 Testing Patch Generation (Manual Control)"
echo "============================================"
echo ""
echo "📷 Input image: $IMAGE_PATH"
echo "🔌 Socket: $SOCKET"
echo "📁 Output directory: $OUTPUT_DIR"
echo ""

# Check if image exists
if [ ! -f "$IMAGE_PATH" ]; then
    echo "❌ Error: Image not found: $IMAGE_PATH"
    exit 1
fi

# Check if socket exists
if [ ! -S "$SOCKET" ]; then
    echo "❌ Error: Socket not found: $SOCKET"
    echo "   Is the manga-ocr container running?"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Base64 encode the image
echo "📦 Encoding image to base64..."
IMAGE_BASE64=$(base64 -w 0 "$IMAGE_PATH")

# Function to test patch generation
test_patch() {
    local name=$1
    local text_lines=$2  # JSON array of lines, e.g., '["Line 1", "Line 2"]'
    local font_size=$3
    local font_type=$4
    local text_color=$5
    local stroke_color=$6
    local stroke_width=$7
    local output="${OUTPUT_DIR}/${name}.png"

    echo ""
    echo "🧪 Test: $name"
    echo "   Lines: $(echo "$text_lines" | jq -r '.[0]')..."
    echo "   Font: $font_type ${font_size}px"
    echo "   Color: $text_color"
    if [ "$stroke_width" != "0" ]; then
        echo "   Stroke: $stroke_color ${stroke_width}px"
    fi

    # Create JSON payload using jq for proper escaping
    JSON_PAYLOAD=$(jq -n \
        --arg capturedImage "$IMAGE_BASE64" \
        --argjson translatedText "$text_lines" \
        --argjson fontSize "$font_size" \
        --arg fontType "$font_type" \
        --argjson textColor "$text_color" \
        --argjson strokeColor "$stroke_color" \
        --argjson strokeWidth "$stroke_width" \
        '{
            capturedImage: $capturedImage,
            translatedText: $translatedText,
            fontSize: $fontSize,
            fontType: $fontType,
            textColor: $textColor,
            strokeColor: $strokeColor,
            strokeWidth: $strokeWidth
        }'
    )

    # Send request
    RESPONSE=$(curl -s --unix-socket "$SOCKET" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$JSON_PAYLOAD" \
        http://localhost/generate-patch)

    # Check response
    if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null 2>&1; then
        # Extract and save
        PATCH_BASE64=$(echo "$RESPONSE" | jq -r '.patchImage')
        echo "$PATCH_BASE64" | base64 -d > "$output"

        SIZE=$(stat -f %z "$output" 2>/dev/null || stat -c %s "$output" 2>/dev/null)
        SIZE_KB=$((SIZE / 1024))

        echo "   ✅ Success! Saved to $output (${SIZE_KB}KB)"
    else
        echo "   ❌ Failed!"
        echo "$RESPONSE" | jq .
        return 1
    fi
}

echo ""
echo "🚀 Running tests..."

# Test 1: Simple black text
test_patch \
    "01_simple_black" \
    '["Simple", "Black", "Text"]' \
    40 \
     "regular" \
     '"#FFFFFF"' \
     '"#000000"' \
     2

# # Test 2: Larger font
# test_patch \
#     "02_large_font" \
#     '["Large", "Text"]' \
#     36 \
#     "regular" \
#     '"#000000"' \
#     'null' \
#     0

# # Test 3: Bold text
# test_patch \
#     "03_bold_text" \
#     '["Bold", "Font", "Style"]' \
#     28 \
#     "bold" \
#     '"#000000"' \
#     'null' \
#     0

# # Test 4: White text with black stroke (classic manga style)
# test_patch \
#     "04_white_with_stroke" \
#     '["White Text", "Black Outline"]' \
#     24 \
#     "regular" \
#     '"#FFFFFF"' \
#     '"#000000"' \
#     2

# # Test 5: Colored text
# test_patch \
#     "05_colored_text" \
#     '["Red", "Text"]' \
#     30 \
#     "regular" \
#     '"#FF0000"' \
#     'null' \
#     0

# # Test 6: Blue text with white stroke
# test_patch \
#     "06_blue_with_stroke" \
#     '["Blue", "With", "Outline"]' \
#     26 \
#     "bold" \
#     '"#0000FF"' \
#     '"#FFFFFF"' \
#     3

# # Test 7: Italic text
# test_patch \
#     "07_italic_text" \
#     '["Italic", "Style", "Font"]' \
#     24 \
#     "italic" \
#     '"#000000"' \
#     'null' \
#     0

# # Test 8: Long text with small font
# test_patch \
#     "08_small_multiline" \
#     '["First line here", "Second line here", "Third line here", "Fourth line"]' \
#     18 \
#     "regular" \
#     '"#000000"' \
#     'null' \
#     0

echo ""
echo "🎉 All tests completed successfully!"
echo ""
echo "📊 Summary:"
ls -lh "$OUTPUT_DIR" | tail -n +2 | awk '{print "   " $9 " - " $5}'
echo ""
echo "👀 Check the $OUTPUT_DIR folder to review all generated patches"
