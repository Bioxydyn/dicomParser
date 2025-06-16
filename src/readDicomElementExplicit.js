import findEndOfEncapsulatedElement from './findEndOfEncapsulatedPixelData.js';
import findAndSetUNElementLength from './findAndSetUNElementLength.js';
import readSequenceItemsImplicit  from './readSequenceElementImplicit.js';
import readTag from './readTag.js';
import findItemDelimitationItemAndSetElementLength from './findItemDelimitationItem.js';
import readSequenceItemsExplicit from './readSequenceElementExplicit.js';

/**
 * Internal helper functions for for parsing DICOM elements
 */

const getDataLengthSizeInBytesForVR = (vr) => {
  if (vr === 'OB' ||
      vr === 'OD' ||
      vr === 'OL' ||
      vr === 'OW' ||
      vr === 'SQ' ||
      vr === 'OF' ||
      vr === 'UC' ||
      vr === 'UR' ||
      vr === 'UT' ||
      vr === 'UN') {
    return 4;
  }

  return 2;
};

export default function readDicomElementExplicit (byteStream, warnings, untilTag, maxPosition) {
  if (byteStream === undefined) {
    throw 'dicomParser.readDicomElementExplicit: missing required parameter \'byteStream\'';
  }
  if (maxPosition === undefined) {
    // If maxPosition is not passed, default to the end of the byte array.
    // This maintains compatibility for direct calls not originating from parseDicomDataSetExplicit.
    maxPosition = byteStream.byteArray.length; 
  }

  const tagStartOffset = byteStream.position;

  const element = {
    tagStartOffset,
    tag: readTag(byteStream),
    vr: byteStream.readFixedString(2)
    // length set below based on VR
    // dataOffset set below based on VR and size of length
  };

  const dataLengthSizeBytes = getDataLengthSizeInBytesForVR(element.vr);

  if (dataLengthSizeBytes === 2) {
    element.length = byteStream.readUint16();
    element.dataOffset = byteStream.position;
  } else {
    byteStream.seek(2); // Skip 2 reserved bytes
    element.length = byteStream.readUint32();
    element.dataOffset = byteStream.position;
  }

  if (element.length === 4294967295) {
    element.hadUndefinedLength = true;
  }

  if (element.tag === untilTag) {
    return element;
  }

  // if VR is SQ, parse the sequence items
  if (element.vr === 'SQ') {
    readSequenceItemsExplicit(byteStream, element, warnings);

    return element;
  }

  if (element.length === 4294967295) {
    if (element.tag === 'x7fe00010') {
      findEndOfEncapsulatedElement(byteStream, element, warnings);

      return element;
    } else if (element.vr === 'UN') {
      readSequenceItemsImplicit(byteStream, element);

      return element;
    }

    findItemDelimitationItemAndSetElementLength(byteStream, element);

    return element;
  }

  const posBeforeSeekData = byteStream.position;
  // Ensure we are at dataOffset before seeking. This should generally be true.
  if (posBeforeSeekData !== element.dataOffset) {
    // This case should ideally not happen if prior logic is correct,
    // but as a defensive measure, adjust to dataOffset.
    byteStream.seek(element.dataOffset - posBeforeSeekData); 
  }

  let lengthToSeek = element.length;
  // Check if reading the full element length would exceed maxPosition
  if (element.dataOffset + lengthToSeek > maxPosition) {
    const originalLength = lengthToSeek;
    lengthToSeek = maxPosition - element.dataOffset;
    if (warnings) {
        warnings.push(`DICOM PARSER WARNING: Element ${element.tag} length ${originalLength} exceeds available data up to maxPosition ${maxPosition}. Truncating to ${lengthToSeek}. dataOffset was ${element.dataOffset}`);
    }
    // console.warn(`DICOM PARSER WARNING: Element ${element.tag} length ${originalLength} exceeds available data up to maxPosition ${maxPosition}. Truncating to ${lengthToSeek}. dataOffset was ${element.dataOffset}. Current position ${byteStream.position}`);
    element.length = lengthToSeek; // Update element's length to the truncated one
    element.truncated = true; // Add a flag to indicate truncation
  }

  if (lengthToSeek < 0) { // Should not happen if logic is correct, but as a safeguard
    // console.error(`DICOM PARSER ERROR: Negative lengthToSeek ${lengthToSeek} for tag ${element.tag}. dataOffset: ${element.dataOffset}, maxPosition: ${maxPosition}. Setting seek to 0.`);
    lengthToSeek = 0;
  }
  
  byteStream.seek(lengthToSeek);
  // console.log(`DICOM PARSER DEBUG: readDicomElementExplicit: After seeking data for tag ${element.tag} (length ${lengthToSeek}). New position: ${byteStream.position}`);

  return element;
}
