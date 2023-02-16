# Google Cloud Setup

DEPLOY_PROJECT_ID=<DEPLOY_PROJECT_ID>
gcloud config set project $DEPLOY_PROJECT_ID
DEPLOY_PROJECT_NUMBER=$(gcloud projects describe $DEPLOY_PROJECT_ID --format 'value(projectNumber)')

gcloud services enable iam.googleapis.com cloudbuild.googleapis.com clouddeploy.googleapis.com servicenetworking.googleapis.com container.googleapis.com run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com pubsub.googleapis.com

gcloud artifacts repositories create videointelligencedemo --repository-format=docker --location=europe-west2

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID --member=serviceAccount:$DEPLOY_PROJECT_NUMBER@cloudbuild.gserviceaccount.com --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID --member=serviceAccount:$DEPLOY_PROJECT_NUMBER@cloudbuild.gserviceaccount.com --role="roles/run.admin"

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID --member=serviceAccount:$DEPLOY_PROJECT_NUMBER@cloudbuild.gserviceaccount.com --role="roles/owner"

gcloud beta builds triggers import --project=$DEPLOY_PROJECT_ID --source=build/triggers/trigger.yaml



SOURCE_GCS_BUCKET_LOCATION=<SOURCE_GCS_BUCKET_LOCATION>

PUBSUB_TOPIC_NAME=<PUBSUB_TOPIC_NAME>

CLOUD_RUN_SERVICE_URL=<CLOUD_RUN_SERVICE_URL>


gcloud storage buckets notifications create $SOURCE_GCS_BUCKET_LOCATION --topic=$PUBSUB_TOPIC_NAME

gcloud iam service-accounts create cloud-run-pubsub-invoker \
    --display-name "Cloud Run Pub/Sub Invoker"

gcloud run services add-iam-policy-binding videointelligencedemo \
--member=serviceAccount:cloud-run-pubsub-invoker@$DEPLOY_PROJECT_ID.iam.gserviceaccount.com \
--role=roles/run.invoker

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID \
   --member=serviceAccount:service-$DEPLOY_PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com \
   --role=roles/iam.serviceAccountTokenCreator

gcloud pubsub subscriptions create videointelligencedemo --topic $PUBSUB_TOPIC_NAME \
--ack-deadline=600 \
--push-endpoint=$CLOUD_RUN_SERVICE_URL/ --push-auth-service-account=cloud-run-pubsub-invoker@$DEPLOY_PROJECT_ID.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID \
   --member=serviceAccount:service-$DEPLOY_PROJECT_NUMBER@developer.gserviceaccount.comm \
   --role=roles/iam.serviceAccountTokenCreator