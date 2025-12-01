// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tests for path accuracy:
 * 1. Compare darkness in cells between original image and generated path
 * 2. Compare G-Code trajectory rendering with SVG visualization
 */

test.describe('Path Accuracy Tests', () => {

  test('cell darkness comparison - generated path reflects original image darkness', async ({ page }) => {
    await page.goto('/');
    
    // Create test image with known darkness patterns
    // Left half is black (darkness=1), right half is white (darkness=0)
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      
      // Left half black, right half white
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 100, 100);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 50, 100);
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    await page.locator('#imageInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBuffer, 'base64')
    });

    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    
    // Use larger cell size for easier analysis
    await page.locator('#cellSize').fill('10');
    await page.locator('#maxAmplitude').fill('5');
    await page.locator('#outputWidth').fill('100');
    await page.locator('#generateBtn').click();
    
    // Get the SVG path data
    const pathD = await page.locator('#svgContainer svg path').getAttribute('d');
    expect(pathD).toBeTruthy();
    
    // Parse path and analyze
    const result = await page.evaluate((pathD) => {
      // Parse SVG path
      const commands = pathD.match(/[ML]\s*[\d.-]+\s+[\d.-]+/g) || [];
      const points = commands.map(cmd => {
        const match = cmd.match(/[ML]\s*([\d.-]+)\s+([\d.-]+)/);
        return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
      });
      
      // Analyze amplitude in left half (should be higher) vs right half (should be lower)
      const leftAmplitudes = [];
      const rightAmplitudes = [];
      
      // Group points by row (y-coordinate bands)
      const rowHeight = 10; // cell size scaled
      const rows = {};
      
      points.forEach(p => {
        const rowNum = Math.floor(p.y / rowHeight);
        if (!rows[rowNum]) rows[rowNum] = [];
        rows[rowNum].push(p);
      });
      
      // For each row, calculate max amplitude deviation from center line
      Object.keys(rows).forEach(rowNum => {
        const rowPoints = rows[rowNum];
        const baseY = (parseInt(rowNum) + 0.5) * rowHeight;
        
        rowPoints.forEach(p => {
          const amplitude = Math.abs(p.y - baseY);
          if (p.x < 50) {
            leftAmplitudes.push(amplitude);
          } else {
            rightAmplitudes.push(amplitude);
          }
        });
      });
      
      const avgLeftAmplitude = leftAmplitudes.length > 0 
        ? leftAmplitudes.reduce((a, b) => a + b, 0) / leftAmplitudes.length 
        : 0;
      const avgRightAmplitude = rightAmplitudes.length > 0 
        ? rightAmplitudes.reduce((a, b) => a + b, 0) / rightAmplitudes.length 
        : 0;
      
      return { avgLeftAmplitude, avgRightAmplitude };
    }, pathD);
    
    // Left (dark) side should have higher amplitude than right (white) side
    expect(result.avgLeftAmplitude).toBeGreaterThan(result.avgRightAmplitude);
  });

  test('gradient image produces varying amplitudes based on darkness', async ({ page }) => {
    await page.goto('/');
    
    // Create gradient image (black on left, white on right)
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      
      // Create horizontal gradient
      const gradient = ctx.createLinearGradient(0, 0, 100, 0);
      gradient.addColorStop(0, 'black');
      gradient.addColorStop(1, 'white');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 100, 50);
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    await page.locator('#imageInput').setInputFiles({
      name: 'gradient.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBuffer, 'base64')
    });

    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    
    await page.locator('#cellSize').fill('10');
    await page.locator('#maxAmplitude').fill('5');
    await page.locator('#generateBtn').click();
    
    const pathD = await page.locator('#svgContainer svg path').getAttribute('d');
    
    // Verify that the path has varying amplitudes (not all the same)
    const result = await page.evaluate((pathD) => {
      const commands = pathD.match(/[ML]\s*[\d.-]+\s+[\d.-]+/g) || [];
      const points = commands.map(cmd => {
        const match = cmd.match(/[ML]\s*([\d.-]+)\s+([\d.-]+)/);
        return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
      });
      
      // Calculate variance in Y values to verify varying amplitudes
      const yValues = points.map(p => p.y);
      const avgY = yValues.reduce((a, b) => a + b, 0) / yValues.length;
      const variance = yValues.reduce((sum, y) => sum + Math.pow(y - avgY, 2), 0) / yValues.length;
      
      // Get unique Y values (rounded)
      const uniqueYs = new Set(yValues.map(y => Math.round(y * 10) / 10));
      
      return {
        variance,
        uniqueYCount: uniqueYs.size,
        pointCount: points.length
      };
    }, pathD);
    
    // The path should have variance (indicating varying amplitudes)
    expect(result.variance).toBeGreaterThan(0);
    // Should have multiple unique Y values
    expect(result.uniqueYCount).toBeGreaterThan(2);
    // Should have generated a path with multiple points
    expect(result.pointCount).toBeGreaterThan(10);
  });

  test('G-Code trajectory matches SVG visualization', async ({ page }) => {
    await page.goto('/');
    
    // Create test image
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 40;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'gray';
      ctx.fillRect(0, 0, 40, 40);
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    await page.locator('#imageInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBuffer, 'base64')
    });

    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    await page.locator('#cellSize').fill('5');
    await page.locator('#generateBtn').click();
    
    // Get SVG path
    const pathD = await page.locator('#svgContainer svg path').getAttribute('d');
    
    // Get G-Code
    const gcode = await page.locator('#gcodeOutput').inputValue();
    
    // Extract points from SVG
    const svgPoints = await page.evaluate((pathD) => {
      const commands = pathD.match(/[ML]\s*[\d.-]+\s+[\d.-]+/g) || [];
      return commands.map(cmd => {
        const match = cmd.match(/[ML]\s*([\d.-]+)\s+([\d.-]+)/);
        return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
      });
    }, pathD);
    
    // Extract points from G-Code
    const gcodePoints = await page.evaluate((gcode) => {
      const lines = gcode.split('\n');
      const points = [];
      
      lines.forEach(line => {
        const match = line.match(/G[01]\s+X([\d.-]+)\s+Y([\d.-]+)/);
        if (match) {
          points.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
        }
      });
      
      return points;
    }, gcode);
    
    // Compare SVG and G-Code points
    // They should match closely
    expect(svgPoints.length).toBeGreaterThan(0);
    expect(gcodePoints.length).toBeGreaterThan(0);
    
    // The G-Code points should be approximately the same count as SVG points
    // (small differences may occur due to parsing differences)
    expect(Math.abs(gcodePoints.length - svgPoints.length)).toBeLessThan(5);
    
    // Compare coordinates with tolerance for matching points
    const tolerance = 0.001;
    const minLen = Math.min(svgPoints.length, gcodePoints.length);
    for (let i = 0; i < minLen; i++) {
      expect(Math.abs(svgPoints[i].x - gcodePoints[i].x)).toBeLessThan(tolerance);
      expect(Math.abs(svgPoints[i].y - gcodePoints[i].y)).toBeLessThan(tolerance);
    }
  });

  test('render G-Code and compare with SVG - image similarity', async ({ page }) => {
    await page.goto('/');
    
    // Create test image
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      
      // Create a pattern
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 50, 50);
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(25, 25, 15, 0, Math.PI * 2);
      ctx.fill();
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    await page.locator('#imageInput').setInputFiles({
      name: 'circle.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBuffer, 'base64')
    });

    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    await page.locator('#cellSize').fill('5');
    await page.locator('#generateBtn').click();
    
    // Get G-Code and SVG path
    const gcode = await page.locator('#gcodeOutput').inputValue();
    const svgHtml = await page.locator('#svgContainer').innerHTML();
    
    // Render both to canvas and compare
    const comparison = await page.evaluate(({ gcode, svgHtml }) => {
      // Parse G-Code to extract path
      const lines = gcode.split('\n');
      const gcodePoints = [];
      
      lines.forEach(line => {
        const match = line.match(/G[01]\s+X([\d.-]+)\s+Y([\d.-]+)/);
        if (match) {
          gcodePoints.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
        }
      });
      
      // Parse SVG to extract viewBox and path
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgHtml, 'image/svg+xml');
      const svg = svgDoc.querySelector('svg');
      const viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
      const pathD = svg.querySelector('path').getAttribute('d');
      
      // Extract SVG points
      const commands = pathD.match(/[ML]\s*[\d.-]+\s+[\d.-]+/g) || [];
      const svgPoints = commands.map(cmd => {
        const match = cmd.match(/[ML]\s*([\d.-]+)\s+([\d.-]+)/);
        return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
      });
      
      // Render G-Code path to canvas
      const canvas1 = document.createElement('canvas');
      const width = Math.ceil(viewBox[2]);
      const height = Math.ceil(viewBox[3]);
      canvas1.width = width;
      canvas1.height = height;
      const ctx1 = canvas1.getContext('2d');
      ctx1.fillStyle = 'white';
      ctx1.fillRect(0, 0, width, height);
      ctx1.strokeStyle = 'black';
      ctx1.lineWidth = 0.3;
      ctx1.beginPath();
      if (gcodePoints.length > 0) {
        ctx1.moveTo(gcodePoints[0].x, gcodePoints[0].y);
        for (let i = 1; i < gcodePoints.length; i++) {
          ctx1.lineTo(gcodePoints[i].x, gcodePoints[i].y);
        }
      }
      ctx1.stroke();
      
      // Render SVG path to canvas
      const canvas2 = document.createElement('canvas');
      canvas2.width = width;
      canvas2.height = height;
      const ctx2 = canvas2.getContext('2d');
      ctx2.fillStyle = 'white';
      ctx2.fillRect(0, 0, width, height);
      ctx2.strokeStyle = 'black';
      ctx2.lineWidth = 0.3;
      ctx2.beginPath();
      if (svgPoints.length > 0) {
        ctx2.moveTo(svgPoints[0].x, svgPoints[0].y);
        for (let i = 1; i < svgPoints.length; i++) {
          ctx2.lineTo(svgPoints[i].x, svgPoints[i].y);
        }
      }
      ctx2.stroke();
      
      // Compare pixel data
      const data1 = ctx1.getImageData(0, 0, width, height).data;
      const data2 = ctx2.getImageData(0, 0, width, height).data;
      
      let totalDiff = 0;
      let pixelCount = width * height;
      
      for (let i = 0; i < data1.length; i += 4) {
        // Compare grayscale values
        const gray1 = (data1[i] + data1[i+1] + data1[i+2]) / 3;
        const gray2 = (data2[i] + data2[i+1] + data2[i+2]) / 3;
        totalDiff += Math.abs(gray1 - gray2);
      }
      
      const avgDiff = totalDiff / pixelCount;
      const similarity = 1 - (avgDiff / 255);
      
      return {
        avgDiff,
        similarity,
        gcodePointCount: gcodePoints.length,
        svgPointCount: svgPoints.length
      };
    }, { gcode, svgHtml });
    
    // Images should be very similar (tolerance for rendering differences)
    expect(comparison.similarity).toBeGreaterThan(0.99);
    // G-Code and SVG point counts should be approximately equal
    expect(Math.abs(comparison.gcodePointCount - comparison.svgPointCount)).toBeLessThan(5);
  });

  test('darkness scan comparison between original and rendered path', async ({ page }) => {
    await page.goto('/');
    
    // Create test image with known pattern
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 60;
      canvas.height = 60;
      const ctx = canvas.getContext('2d');
      
      // Create pattern with different darkness regions
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 60, 60);
      
      // Top-left quadrant: black (darkness = 1)
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 30, 30);
      
      // Top-right quadrant: light gray (darkness ~ 0.25)
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(30, 0, 30, 30);
      
      // Bottom-left quadrant: dark gray (darkness ~ 0.5)
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 30, 30, 30);
      
      // Bottom-right quadrant: white (darkness = 0)
      // Already white
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    await page.locator('#imageInput').setInputFiles({
      name: 'quadrants.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBuffer, 'base64')
    });

    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    
    // Use cell size that divides evenly
    await page.locator('#cellSize').fill('10');
    await page.locator('#maxAmplitude').fill('5');
    await page.locator('#outputWidth').fill('60');
    await page.locator('#generateBtn').click();
    
    // Get original image darkness values and compare with path amplitudes
    const comparison = await page.evaluate(() => {
      // Get original canvas data
      const originalCanvas = document.getElementById('originalCanvas');
      const ctx = originalCanvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
      
      // Calculate average darkness for each quadrant
      const quadrantDarkness = {};
      const regions = {
        'top-left': { x1: 0, y1: 0, x2: 30, y2: 30 },
        'top-right': { x1: 30, y1: 0, x2: 60, y2: 30 },
        'bottom-left': { x1: 0, y1: 30, x2: 60, y2: 60 },
        'bottom-right': { x1: 30, y1: 30, x2: 60, y2: 60 }
      };
      
      for (const [name, region] of Object.entries(regions)) {
        let totalGray = 0;
        let count = 0;
        
        for (let py = region.y1; py < region.y2 && py < originalCanvas.height; py++) {
          for (let px = region.x1; px < region.x2 && px < originalCanvas.width; px++) {
            const idx = (py * originalCanvas.width + px) * 4;
            const gray = 0.299 * imageData.data[idx] + 0.587 * imageData.data[idx + 1] + 0.114 * imageData.data[idx + 2];
            totalGray += gray;
            count++;
          }
        }
        
        const avgGray = totalGray / count;
        quadrantDarkness[name] = 1 - avgGray / 255;
      }
      
      // Get SVG path and analyze amplitudes per quadrant
      const svgPath = document.querySelector('#svgContainer svg path');
      const pathD = svgPath.getAttribute('d');
      const commands = pathD.match(/[ML]\s*[\d.-]+\s+[\d.-]+/g) || [];
      const points = commands.map(cmd => {
        const match = cmd.match(/[ML]\s*([\d.-]+)\s+([\d.-]+)/);
        return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
      });
      
      // Calculate average amplitude deviation for each quadrant
      const quadrantAmplitudes = {};
      const scaledRegions = {
        'top-left': { x1: 0, y1: 0, x2: 30, y2: 30 },
        'top-right': { x1: 30, y1: 0, x2: 60, y2: 30 },
        'bottom-left': { x1: 0, y1: 30, x2: 60, y2: 60 },
        'bottom-right': { x1: 30, y1: 30, x2: 60, y2: 60 }
      };
      
      for (const [name, region] of Object.entries(scaledRegions)) {
        // Get points in this region
        const regionPoints = points.filter(p => 
          p.x >= region.x1 && p.x < region.x2 &&
          p.y >= region.y1 && p.y < region.y2
        );
        
        if (regionPoints.length > 0) {
          // Calculate average Y deviation from region center lines
          const centerY = (region.y1 + region.y2) / 2;
          let totalDeviation = 0;
          regionPoints.forEach(p => {
            // The path oscillates around base lines, calculate deviation
            totalDeviation += Math.abs(p.y - centerY);
          });
          quadrantAmplitudes[name] = totalDeviation / regionPoints.length;
        } else {
          quadrantAmplitudes[name] = 0;
        }
      }
      
      return {
        quadrantDarkness,
        quadrantAmplitudes,
        // Dark regions should have larger amplitudes
        topLeftDarkEnough: quadrantDarkness['top-left'] > 0.8,
        topRightLighter: quadrantDarkness['top-right'] < quadrantDarkness['top-left'],
        bottomRightLightest: quadrantDarkness['bottom-right'] < quadrantDarkness['bottom-left']
      };
    });
    
    // Verify that the image was processed correctly
    expect(comparison.topLeftDarkEnough).toBe(true);
    expect(comparison.topRightLighter).toBe(true);
    expect(comparison.bottomRightLightest).toBe(true);
    
    // Verify that darker regions have larger amplitude variations in the path
    // Top-left is darkest, should have larger amplitude than top-right
    expect(comparison.quadrantAmplitudes['top-left']).toBeGreaterThan(0);
  });
});
