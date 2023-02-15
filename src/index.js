'use strict';

const video = require('@google-cloud/video-intelligence').v1;
const {BigQuery} = require('@google-cloud/bigquery');
const {Storage} = require('@google-cloud/storage');

async function analyzeFile(gcsUri, features) {

  // Creates a client
  const client = new video.VideoIntelligenceServiceClient();

  const request = {
    inputUri: gcsUri,
    features: [],
  };

  // 'LABEL_DETECTION', //Detects labels in a video
  // 'SHOT_CHANGE_DETECTION', // Detects camera shot changes
  // 'EXPLICIT_CONTENT_DETECTION' // Detects explicit content
  // 'SPEECH_TRANSCRIPTION' // transcribe speech in the video into text
  // 'TEXT_DETECTION' // Detects text in a video
  // 'OBJECT_TRACKING' // like Lebel Detection but also provides bounding boxes of the locations of the objects
  
  if (!features || features === 'ALL') {
    request.features = ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION', 'EXPLICIT_CONTENT_DETECTION', 'SPEECH_TRANSCRIPTION', 'TEXT_DETECTION'] //'OBJECT_TRACKING' is not enabled unless explicitely stated in request params given the additional latency it creates.
    request.videoContext = {
      speechTranscriptionConfig: {
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
      },
    }   
  }
  
  if (features.includes('LABEL_DETECTION')){
    request.features.push('LABEL_DETECTION')
  }

  if (features.includes('SHOT_CHANGE_DETECTION')){
    request.features.push('SHOT_CHANGE_DETECTION')
  }

  if (features.includes('EXPLICIT_CONTENT_DETECTION')){
    request.features.push('EXPLICIT_CONTENT_DETECTION')
  }
  
  if (features.includes('SPEECH_TRANSCRIPTION')){
    request.features.push('SPEECH_TRANSCRIPTION')
    request.videoContext = {
      speechTranscriptionConfig: {
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
      },
    }   
  }

  if (features.includes('TEXT_DETECTION')){
    request.features.push('TEXT_DETECTION')
  }

  if (features.includes('OBJECT_TRACKING')){
    request.features.push('OBJECT_TRACKING')
    request.locationId = 'us-east1' //recommended to use us-east1 for the best latency due to different types of processors used in this region and others
  }

  console.log('Analyzing file with Video Intelligence API...');
  console.log('Using the following request parameters: ');
  console.log(request)

  const [operation] = await client.annotateVideo(request);
  const [operationResult] = await operation.promise();
  const annotationResults = operationResult.annotationResults[0];

  return annotationResults
}

async function saveToGCS(annotationResults) {
  console.log('saving to GCS...')
  
  const bucketName = 'clip-insights'
  const sourceFileName = annotationResults.inputUri.split('/').pop().split('.').shift()
  const timestamp = new Date().toLocaleString("en-GB", {timeZone: "GB"}).replaceAll(':','-').replaceAll(',','-').replaceAll('/','-').replaceAll(' ', '')
  const destFileName = sourceFileName + '-' + timestamp + '.json'
  const contents = JSON.stringify(annotationResults).replaceAll('{}', 'null')

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

  const bucketName = uploadedFileDetails.bucketName;
  const filename = uploadedFileDetails.destFileName;

  const datasetId = "video_intelligence_output";
  const tableId = "video-intelligence-output";

  const metadata = {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    autodetect: true,
    location: 'europe-west2',
    createDisposition: 'CREATE_IF_NEEDED',
    writeDisposition: 'WRITE_APPEND',
    schemaUpdateOptions: ['ALLOW_FIELD_ADDITION', 'ALLOW_FIELD_RELAXATION']
  };

    // Load data from a Google Cloud Storage file into the table
    const [job] = await bigquery
      .dataset(datasetId)
      .table(tableId)
      .load(storage.bucket(bucketName).file(filename), metadata);

    console.log(`Job ${job.id} completed.`);

    return job

}



const express = require('express');
const app = express();
app.use(express.json());

app.post('/*', async (req, res) => {
  
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
  
  const bucketID = req.body.message.attributes.bucketId
  const fileName = req.body.message.attributes.objectId

  const gcsUri = `gs://${bucketID}/${fileName}`
  console.log("SOURCE GCS OBJECT URI: ", gcsUri)

  await analyzeFile(gcsUri, req.originalUrl.toUpperCase().trim().replaceAll('-', '_').replace('/', '')).then((annotationResults) => {
    saveToGCS(annotationResults).then((uploadedFileDetails) => {
      saveToBigQuery(uploadedFileDetails).then((response) => {
        res.status(200).send(annotationResults)
      })
    })
    

}).catch((e) => {
    console.log('e', e) // if the async function threw an error, this would be returned here
})

});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});