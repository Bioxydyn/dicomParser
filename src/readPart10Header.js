import ByteStream from './byteStream.js';
import DataSet from './dataSet.js';
import littleEndianByteArrayParser from './littleEndianByteArrayParser.js';
import readDicomElementExplicit from './readDicomElementExplicit.js';
import readDicomElementImplicit from './readDicomElementImplicit.js';

/**
 * Parses a DICOM P10 byte array and returns a DataSet object with the parsed elements.  If the options
 * argument is supplied and it contains the untilTag property, parsing will stop once that
 * tag is encoutered.  This can be used to parse partial byte streams.
 *
 * @param byteArray the byte array
 * @param options Optional options values
 *    TransferSyntaxUID: String to specify a default raw transfer syntax UID.
 *        Use the LEI transfer syntax for raw files, or the provided one for SCP transfers.
 * @returns {DataSet}
 * @throws error if an error occurs while parsing.  The exception object will contain a property dataSet with the
 *         elements successfully parsed before the error.
 */

export default function readPart10Header (byteArray, options = {}) {
  if (byteArray === undefined) {
    throw 'dicomParser.readPart10Header: missing required parameter \'byteArray\'';
  }

  const { TransferSyntaxUID } = options;
  const littleEndianByteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

  function readPrefix() {
    if (littleEndianByteStream.getSize() <= 132 && TransferSyntaxUID) {
      return false;
    }
    littleEndianByteStream.seek(128);
    const prefix = littleEndianByteStream.readFixedString(4);

    if (prefix !== 'DICM') {
      const { TransferSyntaxUID } = options || {};
      if (!TransferSyntaxUID) {
        throw 'dicomParser.readPart10Header: DICM prefix not found at location 132 - this is not a valid DICOM P10 file.';
      }
      littleEndianByteStream.seek(0);
      return false;
    }
    return true;
  }

  function getMetaVRLittleEndian(tag) {
    if (tag === 'x00020000') return 'UL'; // File Meta Information Group Length
    if (tag === 'x00020001') return 'OB'; // File Meta Information Version
    if (tag === 'x00020002') return 'UI'; // Media Storage SOP Class UID
    if (tag === 'x00020003') return 'UI'; // Media Storage SOP Instance UID
    if (tag === 'x00020010') return 'UI'; // Transfer Syntax UID
    if (tag === 'x00020012') return 'UI'; // Implementation Class UID
    if (tag === 'x00020013') return 'SH'; // Implementation Version Name
    if (tag === 'x00020016') return 'AE'; // Source Application Entity Title
    // According to PS3.5 Table 7.1-1, these are the defined File Meta Information tags
    // Other group 2 tags are not expected in the meta header.
    // console.warn(`readPart10Header:getMetaVRLittleEndian: Unknown meta tag ${tag} encountered.`);
    return undefined; // Or 'UN' if specific handling for unknown group 2 tags is preferred
  }

  // main function here
  function readTheHeader() {
    // Per the DICOM standard, the header is always encoded in Explicit VR Little Endian (see PS3.10, section 7.1)
    // so use littleEndianByteStream throughout this method regardless of the transfer syntax
    const isPart10 = readPrefix();

    const warnings = [];
    const elements = {};
    let metaHeaderIsExplicit = true; // Assume explicit first
    let firstMetaElementAttempted = false;


    if (!isPart10) {
      // console.log('readPart10Header: Not a Part 10 file, or TransferSyntaxUID provided. Creating dummy metaHeaderDataSet.');
      littleEndianByteStream.position = 0;
      const metaHeaderDataSet = {
        elements: { x00020010: { tag: 'x00020010', vr: 'UI', Value: TransferSyntaxUID } },
        warnings,
      };
      // console.log('Returning metaHeaderDataSet', metaHeaderDataSet);
      return metaHeaderDataSet;
    }

    while (littleEndianByteStream.position < littleEndianByteStream.byteArray.length) {
      const currentPositionBeforeRead = littleEndianByteStream.position;
      let element;

      if (metaHeaderIsExplicit) {
        // console.log(`readPart10Header: Attempting to read meta element EXPLICITLY at position ${currentPositionBeforeRead}`);
        element = readDicomElementExplicit(littleEndianByteStream, warnings);
        // console.log(`readPart10Header: EXPLICITLY read element ${element.tag}, length ${element.length}, VR ${element.vr}, new position ${littleEndianByteStream.position}`);

        if (!firstMetaElementAttempted) {
          firstMetaElementAttempted = true; // Mark that we've processed the first element attempt
          // Check if VR is valid (two uppercase letters)
          if (!element.vr || !/^[A-Z]{2}$/.test(element.vr)) {
            // console.log(`readPart10Header: First meta element's VR ('${element.vr}') is not valid. Switching to IMPLICIT meta header parsing. Current stream position before seek: ${littleEndianByteStream.position}`);
            metaHeaderIsExplicit = false;
            // Reset stream to before the explicit read attempt
            littleEndianByteStream.position = currentPositionBeforeRead; // Direct assignment for absolute positioning
            // console.log(`readPart10Header: Stream position after direct assignment to ${currentPositionBeforeRead}: ${littleEndianByteStream.position}. Restarting loop for implicit read.`);
            // Discard the incorrectly parsed element and restart loop to read implicitly
            continue;
          }
          // VR is valid, proceed with this element
        }
      } else {
        // console.log(`readPart10Header: Attempting to read meta element IMPLICITLY at position ${currentPositionBeforeRead}`);
        element = readDicomElementImplicit(littleEndianByteStream, undefined, getMetaVRLittleEndian);
        // console.log(`readPart10Header: IMPLICITLY read element ${element.tag}, length ${element.length}, VR ${element.vr}, new position ${littleEndianByteStream.position}`);
      }

      if (element.tag > 'x0002ffff') {
        // console.log(`readPart10Header: Encountered tag ${element.tag}, exiting meta header parsing loop.`);
        littleEndianByteStream.position = currentPositionBeforeRead; // Revert position to before this non-meta tag
        break;
      }
      // Cache the littleEndianByteArrayParser for meta header elements, since the rest of the data set may be big endian
      // and this parser will be needed later if the meta header values are to be read.
      element.parser = littleEndianByteArrayParser;
      elements[element.tag] = element;
    }

    // console.log('readPart10Header: Finished parsing meta header elements. Elements found:', Object.keys(elements));
    const metaHeaderDataSet = new DataSet(littleEndianByteStream.byteArrayParser, littleEndianByteStream.byteArray, elements);

    metaHeaderDataSet.warnings = littleEndianByteStream.warnings;
    metaHeaderDataSet.position = littleEndianByteStream.position;

    return metaHeaderDataSet;
  }

  // This is where we actually start parsing
  return readTheHeader();
}
