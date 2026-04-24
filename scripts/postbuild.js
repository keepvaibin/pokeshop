#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

// Standalone setup for Next.js
// Copy static assets and public folder to standalone output

const copyRecursiveSync = (src, dest) => {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
};

try {
  console.log('Setting up standalone output...');
  
  // Copy .next/static to .next/standalone/.next/static
  const staticSrc = path.join(__dirname, '../.next/static');
  const staticDest = path.join(__dirname, '../.next/standalone/.next/static');
  
  if (fs.existsSync(staticSrc)) {
    console.log('Copying .next/static to standalone...');
    copyRecursiveSync(staticSrc, staticDest);
  }
  
  // Copy public to .next/standalone/public
  const publicSrc = path.join(__dirname, '../public');
  const publicDest = path.join(__dirname, '../.next/standalone/public');
  
  if (fs.existsSync(publicSrc)) {
    console.log('Copying public to standalone...');
    copyRecursiveSync(publicSrc, publicDest);
  }
  
  console.log('✓ Standalone setup complete!');
} catch (error) {
  console.error('Failed to setup standalone output:', error);
  process.exit(1);
}
