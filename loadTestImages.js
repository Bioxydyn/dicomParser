/* eslint-disable max-len, quotes, no-sync, func-style, no-console, no-unused-vars, no-undef, no-restricted-syntax, prefer-const, no-inner-declarations */

// Run with e.g., NODE_OPTIONS=--openssl-legacy-provider npm run build > /dev/null && node loadTestImages.js

const dicomParser = require('./dist/dicomParser.min.js');
const fs = require('fs');
const path = require('path');

function parseAndDisplayDicomFile(filePath) {
  try {
    console.log(`\n--- Parsing: ${filePath} ---`);
    const fullPath = path.join(__dirname, filePath);
    const dicomFileAsBuffer = fs.readFileSync(fullPath);
    const byteArray = new Uint8Array(dicomFileAsBuffer);

    const dataSet = dicomParser.parseDicom(byteArray);

    // Access and display some basic tags
    const transferSyntax = dataSet.string('x00020010');
    const SOPClassUID = dataSet.string('x00080016');
    const patientName = dataSet.string('x00100010');
    const studyDate = dataSet.string('x00080020');
    const studyTime = dataSet.string('x00080030');

    console.log(`Transfer Syntax UID: ${transferSyntax || 'Not found'}`);
    console.log(`SOP Class UID: ${SOPClassUID || 'Not found'}`);
    console.log(`Patient's Name: ${patientName || 'Not found'}`);
    console.log(`Study Date: ${studyDate || 'Not found'}`);
    console.log(`Study Time: ${studyTime || 'Not found'}`);
  } catch (ex) {
    console.error(`Error parsing ${filePath}:`, ex.message || ex);
    if (ex.dataSet) {
      console.log("Partial dataSet available");
    }
  }
}

const filesToTest = [
  'testImages/CT1_UNC.explicit_little_endian.dcm',
  'testImages/broken_ct.dcm',
  'testImages/GE_DLX-8-MONO2-PrivateSyntax.dcm',
  'testImages/undefined_length_un_vr.dcm',
  'testImages/broken-ge-US000001.dcm'
];

// To run all files later:
filesToTest.forEach(parseAndDisplayDicomFile);

console.log("\n--- Script finished ---");
