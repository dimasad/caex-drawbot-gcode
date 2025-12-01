/**
 * Pen Plotter G-Code Generator
 * Uses a Hatch Sawtooth algorithm to generate continuous pen paths
 */

// DOM Elements
const imageInput = document.getElementById('imageInput');
const fileName = document.getElementById('fileName');
const generateBtn = document.getElementById('generateBtn');
const cellSizeInput = document.getElementById('cellSize');
const maxAmplitudeInput = document.getElementById('maxAmplitude');
const outputWidthInput = document.getElementById('outputWidth');
const originalCanvas = document.getElementById('originalCanvas');
const previewSection = document.getElementById('previewSection');
const svgSection = document.getElementById('svgSection');
const svgContainer = document.getElementById('svgContainer');
const gcodeSection = document.getElementById('gcodeSection');
const gcodeOutput = document.getElementById('gcodeOutput');
const downloadBtn = document.getElementById('downloadBtn');

let loadedImage = null;
let currentGCode = '';

// Event Listeners
imageInput.addEventListener('change', handleImageUpload);
generateBtn.addEventListener('click', generateGCode);
downloadBtn.addEventListener('click', downloadGCode);

/**
 * Handle image upload
 */
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            loadedImage = img;
            displayOriginalImage(img);
            generateBtn.disabled = false;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Display the original image on canvas
 */
function displayOriginalImage(img) {
    const ctx = originalCanvas.getContext('2d');
    originalCanvas.width = img.width;
    originalCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    previewSection.style.display = 'block';
}

/**
 * Get grayscale value (0-255, 0 = black, 255 = white)
 */
function getGrayscale(r, g, b, a) {
    // Convert to grayscale using luminance formula
    // Also consider alpha - transparent pixels are treated as white
    if (a < 128) return 255;
    return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Calculate average darkness for a cell (0 = white, 1 = black)
 */
function getCellDarkness(imageData, x, y, cellSize, imgWidth, imgHeight) {
    let totalGray = 0;
    let count = 0;

    const startX = Math.floor(x);
    const startY = Math.floor(y);
    const endX = Math.min(startX + cellSize, imgWidth);
    const endY = Math.min(startY + cellSize, imgHeight);

    for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
            const idx = (py * imgWidth + px) * 4;
            const gray = getGrayscale(
                imageData.data[idx],
                imageData.data[idx + 1],
                imageData.data[idx + 2],
                imageData.data[idx + 3]
            );
            totalGray += gray;
            count++;
        }
    }

    if (count === 0) return 0;
    // Convert to darkness (0 = white, 1 = black)
    return 1 - (totalGray / count / 255);
}

/**
 * Generate Hatch Sawtooth path
 * Creates a continuous zigzag path where amplitude varies based on image darkness
 */
function generateHatchSawtoothPath(imageData, imgWidth, imgHeight, cellSize, maxAmplitude, outputWidth) {
    const scale = outputWidth / imgWidth;
    const outputHeight = imgHeight * scale;
    const scaledCellSize = cellSize * scale;

    const numRows = Math.ceil(imgHeight / cellSize);
    const numCols = Math.ceil(imgWidth / cellSize);

    const path = [];
    
    // Start at top-left
    let currentX = 0;
    let currentY = scaledCellSize / 2;

    path.push({ x: currentX, y: currentY });

    for (let row = 0; row < numRows; row++) {
        const y = row * cellSize;
        const baseY = (row + 0.5) * scaledCellSize;
        const goingRight = row % 2 === 0;

        if (goingRight) {
            // Going left to right
            for (let col = 0; col < numCols; col++) {
                const x = col * cellSize;
                const darkness = getCellDarkness(imageData, x, y, cellSize, imgWidth, imgHeight);
                const amplitude = darkness * maxAmplitude;

                const cellCenterX = (col + 0.5) * scaledCellSize;
                const cellStartX = col * scaledCellSize;
                const cellEndX = Math.min((col + 1) * scaledCellSize, outputWidth);

                // Create sawtooth within cell
                // Peak at center, valleys at edges
                if (col === 0) {
                    // First cell - start from edge
                    path.push({ x: cellCenterX, y: baseY - amplitude });
                    path.push({ x: cellEndX, y: baseY });
                } else {
                    path.push({ x: cellCenterX, y: baseY - amplitude });
                    path.push({ x: cellEndX, y: baseY });
                }
            }
        } else {
            // Going right to left
            for (let col = numCols - 1; col >= 0; col--) {
                const x = col * cellSize;
                const darkness = getCellDarkness(imageData, x, y, cellSize, imgWidth, imgHeight);
                const amplitude = darkness * maxAmplitude;

                const cellCenterX = (col + 0.5) * scaledCellSize;
                const cellStartX = col * scaledCellSize;
                const cellEndX = Math.min((col + 1) * scaledCellSize, outputWidth);

                // Create sawtooth within cell (reversed direction)
                if (col === numCols - 1) {
                    path.push({ x: cellCenterX, y: baseY - amplitude });
                    path.push({ x: cellStartX, y: baseY });
                } else {
                    path.push({ x: cellCenterX, y: baseY - amplitude });
                    path.push({ x: cellStartX, y: baseY });
                }
            }
        }

        // Connect to next row (if not last row)
        if (row < numRows - 1) {
            const nextBaseY = (row + 1.5) * scaledCellSize;
            if (goingRight) {
                // We're at right edge, move down
                path.push({ x: outputWidth, y: nextBaseY });
            } else {
                // We're at left edge, move down
                path.push({ x: 0, y: nextBaseY });
            }
        }
    }

    return { path, outputWidth, outputHeight };
}

/**
 * Generate SVG from path
 */
function generateSVG(pathData) {
    const { path, outputWidth, outputHeight } = pathData;
    
    if (path.length < 2) return '';

    let pathD = `M ${path[0].x.toFixed(3)} ${path[0].y.toFixed(3)}`;
    for (let i = 1; i < path.length; i++) {
        pathD += ` L ${path[i].x.toFixed(3)} ${path[i].y.toFixed(3)}`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outputWidth.toFixed(3)} ${outputHeight.toFixed(3)}" width="${outputWidth}" height="${outputHeight}">
    <rect width="100%" height="100%" fill="white"/>
    <path d="${pathD}" fill="none" stroke="black" stroke-width="0.3"/>
</svg>`;

    return svg;
}

/**
 * Generate G-Code from path
 * No pen lifts - continuous path
 */
function generateGCodeFromPath(pathData, feedRate = 1000) {
    const { path } = pathData;
    
    if (path.length < 2) return '';

    let gcode = [];
    
    // Header
    gcode.push('; G-Code generated by Pen Plotter G-Code Generator');
    gcode.push('; Hatch Sawtooth Algorithm - Continuous path (no pen lifts)');
    gcode.push(`; Generated: ${new Date().toISOString()}`);
    gcode.push('');
    gcode.push('G21 ; Set units to millimeters');
    gcode.push('G90 ; Absolute positioning');
    gcode.push('G17 ; XY plane selection');
    gcode.push('');
    
    // Move to start position (pen up)
    gcode.push('; Move to start position');
    gcode.push('M5 ; Pen up');
    gcode.push(`G0 X${path[0].x.toFixed(3)} Y${path[0].y.toFixed(3)}`);
    gcode.push('');
    
    // Lower pen and draw
    gcode.push('; Begin drawing');
    gcode.push('M3 ; Pen down');
    gcode.push(`G1 F${feedRate}`);
    gcode.push('');
    
    // Draw path (no pen lifts)
    for (let i = 1; i < path.length; i++) {
        gcode.push(`G1 X${path[i].x.toFixed(3)} Y${path[i].y.toFixed(3)}`);
    }
    
    // Footer
    gcode.push('');
    gcode.push('; End of drawing');
    gcode.push('M5 ; Pen up');
    gcode.push('G0 X0 Y0 ; Return to origin');
    gcode.push('M2 ; End program');

    return gcode.join('\n');
}

/**
 * Main generation function
 */
function generateGCode() {
    if (!loadedImage) return;

    const cellSize = parseInt(cellSizeInput.value) || 5;
    const maxAmplitude = parseFloat(maxAmplitudeInput.value) || 2;
    const outputWidth = parseFloat(outputWidthInput.value) || 100;

    // Get image data
    const ctx = originalCanvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, loadedImage.width, loadedImage.height);

    // Generate path
    const pathData = generateHatchSawtoothPath(
        imageData,
        loadedImage.width,
        loadedImage.height,
        cellSize,
        maxAmplitude,
        outputWidth
    );

    // Generate and display SVG
    const svg = generateSVG(pathData);
    svgContainer.innerHTML = svg;
    svgSection.style.display = 'block';

    // Generate and display G-Code
    currentGCode = generateGCodeFromPath(pathData);
    gcodeOutput.value = currentGCode;
    gcodeSection.style.display = 'block';

    // Scroll to SVG section
    svgSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Download G-Code as file
 */
function downloadGCode() {
    if (!currentGCode) return;

    const blob = new Blob([currentGCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'drawing.gcode';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getGrayscale,
        getCellDarkness,
        generateHatchSawtoothPath,
        generateSVG,
        generateGCodeFromPath
    };
}
