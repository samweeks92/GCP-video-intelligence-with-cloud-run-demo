'use strict';

const video = require('@google-cloud/video-intelligence').v1;
const {BigQuery} = require('@google-cloud/bigquery');
const {Storage} = require('@google-cloud/storage');
const express = require('express');

// ------------------------------------------------------------------------
// This section defines the async functions to implement the service:
// 1. analyzeFile() takes the uploaded source file and sends it for an analysis request to the Video Intelligence API.
// 2. saveToGCS() takes the JSON response from the Video Intelligence API as it's input and uploads to an output GCS Bucket.
// 3. saveToBigQuery() requests a BigQuery upload Job to upload the Video Intelligence API response from the output GCS Bucket.  
// ------------------------------------------------------------------------

async function analyzeFile(gcsUri) {

  console.log(`"Analyzing file ${gcsUri} with Video Intelligence API..."`);
  
  const client = new video.VideoIntelligenceServiceClient();

  // ------------------------------------------------------------------------
  // This section sets the Video Intelligence API's request object appropriately from the env vars
  // ------------------------------------------------------------------------
  
  const request = {
    inputUri: gcsUri,
    features: [],
    videoContext: {
      speechTranscriptionConfig: {},
      faceDetectionConfig: {},
      personDetectionConfig: {}
    }
  };

  // 'LABEL_DETECTION', //Detects labels in a video
  // 'SHOT_CHANGE_DETECTION', // Detects camera shot changes
  // 'EXPLICIT_CONTENT_DETECTION' // Detects explicit content
  // 'SPEECH_TRANSCRIPTION' // transcribe speech in the video into text
  // 'TEXT_DETECTION' // Detects text in a video
  // 'FACE_DETECTION' // looks for faces in a video
  // 'PERSON_DETECTION' // looks for people in a video
  // 'LOGO_RECOGNITION // recognizes logos in a video
  // 'OBJECT_TRACKING' // like Lebel Detection but also provides bounding boxes of the locations of the objects

  if (process.env.ALL_FEATURES === 'true') {
    request.features = ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION', 'EXPLICIT_CONTENT_DETECTION', 'SPEECH_TRANSCRIPTION', 'TEXT_DETECTION', 'FACE_DETECTION', 'PERSON_DETECTION', 'LOGO_RECOGNITION'] //'OBJECT_TRACKING' is not enabled unless explicitely stated in request params given the additional latency it creates.
    request.videoContext.speechTranscriptionConfig = {
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
    }
    request.videoContext.faceDetectionConfig = {
      includeBoundingBoxes: true,
      includeAttributes: true
    }
    request.videoContext.personDetectionConfig = {
      includeBoundingBoxes: true,
      includePoseLandmarks: true,
      includeAttributes: true
    }
  }
  
  if (process.env.FEATURE_LABEL_DETECTION === 'true'){
    request.features.push('LABEL_DETECTION')
  }

  if (process.env.FEATURE_SHOT_CHANGE_DETECTION === 'true'){
    request.features.push('SHOT_CHANGE_DETECTION')
  }

  if (process.env.FEATURE_EXPLICIT_CONTENT_DETECTION === 'true'){
    request.features.push('EXPLICIT_CONTENT_DETECTION')
  }
  
  if (process.env.FEATURE_SPEECH_TRANSCRIPTION === 'true'){
    request.features.push('SPEECH_TRANSCRIPTION')
    request.videoContext.speechTranscriptionConfig = {
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
      }
  }

  if (process.env.FEATURE_TEXT_DETECTION === 'true'){
    request.features.push('TEXT_DETECTION')
  }

  if (process.env.FEATURE_FACE_DETECTION === 'true'){
    request.features.push('FACE_DETECTION')
    request.videoContext.faceDetectionConfig = {
        includeBoundingBoxes: true,
        includeAttributes: true
    }
  }

  if (process.env.FEATURE_PERSON_DETECTION === 'true'){
    request.features.push('PERSON_DETECTION')
    request.videoContext.personDetectionConfig = {
      includeBoundingBoxes: true,
      includePoseLandmarks: true,
      includeAttributes: true
    }   
  }

  if (process.env.FEATURE_LOGO_RECOGNITION === 'true'){
    request.features.push('LOGO_RECOGNITION')
  }

  if (process.env.FEATURE_OBJECT_TRACKING === 'true'){
    request.features.push('OBJECT_TRACKING')
    request.locationId = 'us-east1' //recommended to use us-east1 for the best latency due to different types of processors used in this region and others
  }

  console.log(`Using the following request parameters for file ${gcsUri} : `);
  console.log(request)

  // ------------------------------------------------------------------------
  // This section sends an async request to the Video Intelligence API and awaits and returns the JSON response
  // ------------------------------------------------------------------------

  const [operation] = await client.annotateVideo(request);
  const [operationResult] = await operation.promise();
  const annotationResults = operationResult.annotationResults[0];

  return annotationResults

}

async function saveToGCS(annotationResults) {
  
  console.log('saving to GCS...')
  
  const bucketName = process.env.OUTPUT_BUCKET_NAME
  const sourceFileName = annotationResults.inputUri.split('/').pop().split('.').shift()
  const timestamp = new Date().toLocaleString("en-GB", {timeZone: "GB"}).replaceAll(':','-').replaceAll(',','-').replaceAll('/','-').replaceAll(' ', '')
  const destFileName = sourceFileName + '-' + timestamp + '.json'

  const contents = JSON.stringify(annotationResults).replaceAll('{}', '{"seconds":"0","nanos":0}') // here we remove {} values for when there is no start time and replace with an equivalent {"seconds":"0","nanos":0} to help with the BQ schema

  const storage = new Storage();
  await storage.bucket(bucketName).file(destFileName).save(contents);

  console.log(`File with name: "${destFileName}" was uploaded to GCS Bucket: "${bucketName}"`);

  const uploadedFileDetails = {
    bucketName,
    destFileName
  }
  
  return uploadedFileDetails
}

async function saveToBigQuery(uploadedFileDetails) {

  console.log('saving to BigQuery...')
  
  const bigquery = new BigQuery();
  const storage = new Storage();
  
  const datasetId = process.env.BQ_DATASET_ID;
  const tableId = process.env.BQ_DATASET_TABLE;

  const bucketName = uploadedFileDetails.bucketName;
  const filename = uploadedFileDetails.destFileName;

  const metadata = {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    autodetect: true,
    location: process.env.DATA_LOCATION,
    createDisposition: 'CREATE_IF_NEEDED',
    writeDisposition: 'WRITE_APPEND',
    schemaUpdateOptions: ['ALLOW_FIELD_ADDITION', 'ALLOW_FIELD_RELAXATION']
  };

    // Load data from a Google Cloud Storage file into the table
    const [job] = await bigquery
      .dataset(datasetId)
      .table(tableId)
      .load(storage.bucket(bucketName).file(filename), metadata);

    console.log(`BigQuery load Job ${job.id} has completed.`);

    return job

}

// ------------------------------------------------------------------------
// This section sets up a web serving framework using the express module, with a single POST route that will execute when Pub/Sub Push subcription pushes the message to the Cloud Run endpoint.
// ------------------------------------------------------------------------

const app = express();
app.use(express.json());

app.listen(process.env.PORT, () => {
  console.log(`Listening on port ${process.env.PORT}`);
});

app.post('/*', async (req, res) => {
  
  // ------------------------------------------------------------------------
  // This section validates the request sent to Cloud Run is from Pub/Sub and is of the expected structure and notification type
  // ------------------------------------------------------------------------

  if (!req.body) {
    const msg = 'no Pub/Sub message received';
    console.error(`error: ${msg}`);
    res.status(204).send(`Bad Request: ${msg}`);
    return;
  }
  if (!req.body.message) {
    const msg = 'invalid Pub/Sub message format';
    console.error(`error: ${msg}`);
    res.status(204).send(`Bad Request: ${msg}`);
    return;
  }

  if (req.body.message.attributes.eventType === 'OBJECT_DELETE') {
    console.log('pubsub notification is referencing an object deletion. No new data to send to the Video Intelligence API')
    return ('', 204)
  }

  // ------------------------------------------------------------------------
  // This section validates the request sent to Cloud Run is from Pub/Sub and is of the expected structure and notification type
  // ------------------------------------------------------------------------
  
  const bucketID = req.body.message.attributes.bucketId
  const fileName = req.body.message.attributes.objectId

  const gcsUri = `gs://${bucketID}/${fileName}`

  // chain the async functions defined above
  await analyzeFile(gcsUri).then((annotationResults) => { // call analyzeFile() asynchonously
    saveToGCS(annotationResults).then((uploadedFileDetails) => { // call saveToGCS() asynchonously following promise fulfillment
      saveToBigQuery(uploadedFileDetails).then(() => { // // call saveToBigQuery() asynchonously following promise fulfillment
        res.status(200).send(annotationResults) // in the event of success, return 200 status and the Video Intelligence API results JSON as the response to express POST route
      })
    })  
  }).catch((e) => {
    console.log('e', e) // if the async functions throw any errors, these would be returned here
  })

});