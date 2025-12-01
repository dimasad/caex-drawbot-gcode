// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Test image path - we'll download the test image before running tests
const TEST_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/West_Virginia_Mountaineers_logo.svg/511px-West_Virginia_Mountaineers_logo.svg.png';

test.describe('Pen Plotter G-Code Generator', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads with all required elements', async ({ page }) => {
    // Check title
    await expect(page).toHaveTitle('Pen Plotter G-Code Generator');
    
    // Check main elements exist
    await expect(page.locator('#imageInput')).toBeAttached();
    await expect(page.locator('#generateBtn')).toBeVisible();
    await expect(page.locator('#cellSize')).toBeVisible();
    await expect(page.locator('#maxAmplitude')).toBeVisible();
    await expect(page.locator('#outputWidth')).toBeVisible();
    
    // Generate button should be disabled initially
    await expect(page.locator('#generateBtn')).toBeDisabled();
  });

  test('image upload functionality', async ({ page }) => {
    // Create a simple test image using canvas
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      
      // Draw a gradient pattern
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 100, 100);
      ctx.fillStyle = 'black';
      ctx.fillRect(25, 25, 50, 50);
      
      // Convert to blob and then to base64
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    // Create file from base64
    const buffer = Buffer.from(imageBuffer, 'base64');
    
    // Upload the image using setInputFiles with buffer
    await page.locator('#imageInput').setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: buffer
    });

    // Wait for image to load and check that generate button is enabled
    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    
    // Check that file name is displayed
    await expect(page.locator('#fileName')).toHaveText('test-image.png');
    
    // Check that preview section is visible
    await expect(page.locator('#previewSection')).toBeVisible();
  });

  test('G-Code generation with simple image', async ({ page }) => {
    // Create a simple test image
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      
      // Draw checkerboard pattern for predictable darkness values
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 50, 50);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 25, 25);
      ctx.fillRect(25, 25, 25, 25);
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        }, 'image/png');
      });
    });

    const buffer = Buffer.from(imageBuffer, 'base64');
    
    await page.locator('#imageInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: buffer
    });

    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 5000 });
    
    // Generate G-Code
    await page.locator('#generateBtn').click();
    
    // Check SVG section is visible
    await expect(page.locator('#svgSection')).toBeVisible();
    
    // Check G-Code section is visible
    await expect(page.locator('#gcodeSection')).toBeVisible();
    
    // Check SVG contains a path
    const svgPath = page.locator('#svgContainer svg path');
    await expect(svgPath).toBeAttached();
    
    // Check G-Code output is not empty
    const gcodeText = await page.locator('#gcodeOutput').inputValue();
    expect(gcodeText.length).toBeGreaterThan(0);
    expect(gcodeText).toContain('G21'); // millimeters
    expect(gcodeText).toContain('G90'); // absolute positioning
    expect(gcodeText).toContain('M3'); // pen down
    expect(gcodeText).toContain('M5'); // pen up
    expect(gcodeText).toContain('G1'); // linear move
  });

  test('G-Code has no pen lifts during drawing (continuous path)', async ({ page }) => {
    // Create a test image
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 30;
      canvas.height = 30;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'gray';
      ctx.fillRect(0, 0, 30, 30);
      
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
    await page.locator('#generateBtn').click();
    
    const gcodeText = await page.locator('#gcodeOutput').inputValue();
    
    // Split into lines and check for pen lifts during drawing
    const lines = gcodeText.split('\n');
    let penDownIndex = -1;
    let penUpIndexAfterDrawing = -1;
    let foundG1AfterPenDown = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === 'M3 ; Pen down') {
        penDownIndex = i;
      }
      if (penDownIndex !== -1 && line.startsWith('G1 ')) {
        foundG1AfterPenDown = true;
      }
      if (penDownIndex !== -1 && line === 'M5 ; Pen up' && foundG1AfterPenDown) {
        penUpIndexAfterDrawing = i;
        break;
      }
    }
    
    // Check that there's only one M3 (pen down) command during the drawing section
    const m3Count = lines.filter(l => l.trim() === 'M3 ; Pen down').length;
    expect(m3Count).toBe(1);
    
    // Check there are no M5 commands between pen down and final pen up (except for comments)
    const drawingSection = lines.slice(penDownIndex, penUpIndexAfterDrawing);
    const m5InDrawing = drawingSection.filter(l => l.trim() === 'M5 ; Pen up').length;
    expect(m5InDrawing).toBe(0);
  });

  test('download button creates file', async ({ page }) => {
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 20;
      canvas.height = 20;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 20, 20);
      
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
    await page.locator('#generateBtn').click();
    
    // Set up download listener
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadBtn').click();
    const download = await downloadPromise;
    
    // Check download details
    expect(download.suggestedFilename()).toBe('drawing.gcode');
  });

  test('settings affect output', async ({ page }) => {
    const imageBuffer = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'gray';
      ctx.fillRect(0, 0, 50, 50);
      
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
    
    // Generate with default settings
    await page.locator('#generateBtn').click();
    const gcode1 = await page.locator('#gcodeOutput').inputValue();
    
    // Change output width
    await page.locator('#outputWidth').fill('200');
    await page.locator('#generateBtn').click();
    const gcode2 = await page.locator('#gcodeOutput').inputValue();
    
    // G-Codes should be different
    expect(gcode1).not.toBe(gcode2);
  });
});
