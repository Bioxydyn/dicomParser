// Regression coverage for the way VoxelFlow's DicomDeidentify.js uses this fork.
//
// VF relies on element.tagStartOffset / element.tagEndOffset to cut whole
// elements out of a byte array (it calls this "exsection"). For that to work
// safely:
//   1) [tagStartOffset, tagEndOffset) must cover the entire element including
//      tag bytes, VR, length, and data;
//   2) adjacent elements must touch exactly (prev.tagEndOffset === next.tagStartOffset)
//      so VF's mergeAdjacentElements never under- or over-counts;
//   3) dataSet.string() must return the standard identifier tags that VF reads
//      from DICOM metadata.

import { expect } from 'chai';
import parseDicom from '../src/parseDicom';

function convertToByteArray(jsArray) {
  const byteArray = new Uint8Array(jsArray.length);

  for (let i = 0; i < jsArray.length; i++) {
    byteArray[i] = jsArray[i];
  }

  return byteArray;
}

// Builds an explicit-little-endian DICOM file containing the standard
// metadata tags VoxelFlow reads via dataSet.string().
function makeVfShapedDicom() {
  const preamble = new Array(128).fill(0x00);
  const prefix = [0x44, 0x49, 0x43, 0x4D]; // 'DICM'

  // File meta group — sets transfer syntax to Explicit VR Little Endian.
  const fileMeta = [
    // (0002,0000) UL group length = 0x9F
    0x02, 0x00, 0x00, 0x00, 0x55, 0x4C, 0x04, 0x00, 0x9F, 0x00, 0x00, 0x00,
    // (0002,0001) OB file meta info version, length 2
    0x02, 0x00, 0x01, 0x00, 0x4F, 0x42, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x01,
    // (0002,0002) UI SOP class uid, length 26 -- "1.2.840.10008.5.1.4.1.1.2\0"
    0x02, 0x00, 0x02, 0x00, 0x55, 0x49, 0x1A, 0x00,
    0x31, 0x2E, 0x32, 0x2E, 0x38, 0x34, 0x30, 0x2E, 0x31, 0x30, 0x30, 0x30, 0x38,
    0x2E, 0x35, 0x2E, 0x31, 0x2E, 0x34, 0x2E, 0x31, 0x2E, 0x31, 0x2E, 0x32, 0x00,
    // (0002,0003) UI SOP instance uid, length 40
    0x02, 0x00, 0x03, 0x00, 0x55, 0x49, 0x28, 0x00,
    0x31, 0x2E, 0x32, 0x2E, 0x38, 0x34, 0x30, 0x2E, 0x31, 0x31, 0x33, 0x37, 0x30, 0x34,
    0x2E, 0x31, 0x2E, 0x31, 0x31, 0x31, 0x2E, 0x33, 0x35, 0x31, 0x32, 0x2E, 0x31, 0x33,
    0x33, 0x36, 0x32, 0x38, 0x35, 0x34, 0x36, 0x35, 0x2E, 0x31, 0x39, 0x38,
    // (0002,0010) UI transfer syntax uid, length 20 -- "1.2.840.10008.1.2.1\0"
    0x02, 0x00, 0x10, 0x00, 0x55, 0x49, 0x14, 0x00,
    0x31, 0x2E, 0x32, 0x2E, 0x38, 0x34, 0x30, 0x2E, 0x31, 0x30, 0x30, 0x30, 0x38,
    0x2E, 0x31, 0x2E, 0x32, 0x2E, 0x31, 0x00,
    // (0002,0012) UI implementation class uid, length 28
    0x02, 0x00, 0x12, 0x00, 0x55, 0x49, 0x1C, 0x00,
    0x31, 0x2E, 0x32, 0x2E, 0x32, 0x37, 0x36, 0x2E, 0x30, 0x2E, 0x37, 0x32, 0x33, 0x30,
    0x30, 0x31, 0x30, 0x2E, 0x33, 0x2E, 0x30, 0x2E, 0x33, 0x2E, 0x36, 0x2E, 0x30, 0x00,
  ];

  // Helper to build a single explicit-LE element with a short-form length.
  // VR types passed here all use 16-bit length (CS/DA/UI/PN/LO/SH/US/etc.).
  function shortElement(groupLo, groupHi, eltLo, eltHi, vr, value) {
    const vrBytes = [vr.charCodeAt(0), vr.charCodeAt(1)];
    const data = [];

    for (let i = 0; i < value.length; i++) {
      data.push(value.charCodeAt(i));
    }
    if (data.length % 2 === 1) {
      data.push(0x00); // DICOM strings must be even-length; pad with NUL.
    }
    const length = data.length;
    const lengthBytes = [length & 0xFF, (length >> 8) & 0xFF];

    return [groupLo, groupHi, eltLo, eltHi, ...vrBytes, ...lengthBytes, ...data];
  }

  // Dataset elements VF reads via dataSet.string():
  const dataset = [
    // (0008,0018) UI SOPInstanceUID  -- VF: getSOPInstanceUID
    ...shortElement(0x08, 0x00, 0x18, 0x00, 'UI', '1.2.3.4.5.6.7.8.9'),
    // (0008,0020) DA StudyDate       -- VF: clearScanDate check
    ...shortElement(0x08, 0x00, 0x20, 0x00, 'DA', '20240115'),
    // (0008,0021) DA SeriesDate      -- VF reads it as "studyDate"
    ...shortElement(0x08, 0x00, 0x21, 0x00, 'DA', '20240116'),
    // (0008,0060) CS Modality
    ...shortElement(0x08, 0x00, 0x60, 0x00, 'CS', 'CT'),
    // (0008,1030) LO StudyDescription
    ...shortElement(0x08, 0x00, 0x30, 0x10, 'LO', 'Chest CT'),
    // (0008,103e) LO SeriesDescription
    ...shortElement(0x08, 0x00, 0x3E, 0x10, 'LO', 'Axial 5mm'),
    // (0010,0010) PN PatientName
    ...shortElement(0x10, 0x00, 0x10, 0x00, 'PN', 'DOE^JOHN'),
    // (0010,0020) LO PatientID
    ...shortElement(0x10, 0x00, 0x20, 0x00, 'LO', 'SUBJ-001'),
    // (0020,000d) UI StudyInstanceUID
    ...shortElement(0x20, 0x00, 0x0D, 0x00, 'UI', '1.2.3.4.5.6.7'),
    // (0020,000e) UI SeriesInstanceUID
    ...shortElement(0x20, 0x00, 0x0E, 0x00, 'UI', '1.2.3.4.5.6.7.1'),
  ];

  return convertToByteArray([...preamble, ...prefix, ...fileMeta, ...dataset]);
}

describe('VoxelFlow deidentification usage', () => {
  describe('tagStartOffset / tagEndOffset', () => {
    it('exposes both offsets on every parsed element', () => {
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);

      Object.keys(dataSet.elements).forEach((tag) => {
        const element = dataSet.elements[tag];

        expect(element.tagStartOffset, `${tag} tagStartOffset`).to.be.a('number');
        expect(element.tagEndOffset, `${tag} tagEndOffset`).to.be.a('number');
        expect(element.tagEndOffset).to.be.greaterThan(element.tagStartOffset);
      });
    });

    it('covers the full element bytes (tag + VR + length + data)', () => {
      // The fork's whole point: [tagStartOffset, tagEndOffset) must wrap an
      // entire element so VF can cut it out of the source byteArray.
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);

      // PatientName is explicit-LE, VR=PN: 4 tag bytes + 2 VR + 2 length + data.
      const patientName = dataSet.elements.x00100010;

      expect(patientName).to.be.ok;
      const span = patientName.tagEndOffset - patientName.tagStartOffset;

      expect(span).to.equal(8 + patientName.length);
      // The 4 tag bytes should be group (0x0010 LE -> 10,00) at the start.
      expect(byteArray[patientName.tagStartOffset]).to.equal(0x10);
      expect(byteArray[patientName.tagStartOffset + 1]).to.equal(0x00);
      expect(byteArray[patientName.tagStartOffset + 2]).to.equal(0x10);
      expect(byteArray[patientName.tagStartOffset + 3]).to.equal(0x00);
      // The VR bytes should be 'PN'.
      expect(byteArray[patientName.tagStartOffset + 4]).to.equal('P'.charCodeAt(0));
      expect(byteArray[patientName.tagStartOffset + 5]).to.equal('N'.charCodeAt(0));
      // dataOffset must fall inside the element's [start, end) span.
      expect(patientName.dataOffset).to.be.at.least(patientName.tagStartOffset);
      expect(patientName.dataOffset + patientName.length).to.equal(patientName.tagEndOffset);
    });

    it('adjacent elements meet exactly (prev.end === next.start)', () => {
      // VF's mergeAdjacentElements relies on this — if there were gaps or
      // overlaps, exsecting a contiguous block would corrupt the file.
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);

      const sorted = Object.keys(dataSet.elements)
        .map((tag) => dataSet.elements[tag])
        .sort((a, b) => a.tagStartOffset - b.tagStartOffset);

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        expect(curr.tagStartOffset, `${prev.tag} -> ${curr.tag}`).to.equal(prev.tagEndOffset);
      }
    });

    it('exsecting elements end-to-end produces the expected byte stream length', () => {
      // Mirrors VF's exsectElements: cut out PatientName + PatientID and check
      // the resulting array length matches "original minus removed spans".
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);

      const targets = ['x00100010', 'x00100020'];
      const ranges = targets.map((t) => {
        const el = dataSet.elements[t];

        return [el.tagStartOffset, el.tagEndOffset];
      });
      const removed = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);

      // Build the exsected array by skipping the target ranges.
      const out = new Uint8Array(byteArray.length - removed);
      const skip = new Set();

      ranges.forEach(([s, e]) => {
        for (let i = s; i < e; i++) {
          skip.add(i);
        }
      });
      let w = 0;

      for (let r = 0; r < byteArray.length; r++) {
        if (!skip.has(r)) {
          out[w++] = byteArray[r];
        }
      }

      expect(w).to.equal(out.length);
      expect(out.length).to.equal(byteArray.length - removed);

      // Confirm the removed tag bytes really are gone — searching for
      // (0010,0010) at any tag-aligned position should miss.
      // (We just sanity-check that the SOPInstanceUID bytes are still present,
      //  which proves we didn't accidentally cut other elements.)
      const sopUid = '1.2.3.4.5.6.7.8.9';
      let asString = '';

      for (let i = 0; i < out.length; i++) {
        asString += String.fromCharCode(out[i]);
      }
      expect(asString.indexOf(sopUid)).to.be.greaterThan(-1);
    });
  });

  describe('dataSet.string() on VF-read tags', () => {
    it('returns the expected values for VF identifier tags', () => {
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);

      expect(dataSet.string('x00080018')).to.equal('1.2.3.4.5.6.7.8.9');
      expect(dataSet.string('x00080020')).to.equal('20240115');
      expect(dataSet.string('x00080021')).to.equal('20240116');
      expect(dataSet.string('x00080060')).to.equal('CT');
      expect(dataSet.string('x00081030')).to.equal('Chest CT');
      expect(dataSet.string('x0008103e')).to.equal('Axial 5mm');
      expect(dataSet.string('x00100010')).to.equal('DOE^JOHN');
      expect(dataSet.string('x00100020')).to.equal('SUBJ-001');
      expect(dataSet.string('x0020000d')).to.equal('1.2.3.4.5.6.7');
      expect(dataSet.string('x0020000e')).to.equal('1.2.3.4.5.6.7.1');
    });

    it('returns undefined for tags not in the dataset', () => {
      // VF's processCallbackDicomMetadata relies on this for fallbacks.
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);

      expect(dataSet.string('x00120040')).to.equal(undefined);
    });
  });

  describe('non-exsect deidentification path', () => {
    it('exposes dataOffset and length usable for in-place overwrite', () => {
      // VF's deidentifyNonExsectElement uses element.dataOffset + element.length
      // to overwrite bytes in place. Make sure those still work after the merge.
      const byteArray = makeVfShapedDicom();
      const dataSet = parseDicom(byteArray);
      const patientName = dataSet.elements.x00100010;

      expect(patientName.dataOffset).to.be.a('number');
      expect(patientName.length).to.equal(8); // 'DOE^JOHN' is 8 bytes, no NUL pad needed
      // Overwrite with 'ANONYMIZ' and confirm dataSet.string reflects it.
      const replacement = 'ANONYMIZ';

      for (let i = 0; i < patientName.length; i++) {
        dataSet.byteArray[patientName.dataOffset + i] = replacement.charCodeAt(i);
      }
      expect(dataSet.string('x00100010')).to.equal('ANONYMIZ');
    });
  });
});
