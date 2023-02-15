# Google Cloud Setup

DEPLOY_PROJECT_ID=<DEPLOY_PROJECT_ID>
gcloud config set project $DEPLOY_PROJECT_ID
DEPLOY_PROJECT_NUMBER=$(gcloud projects describe $DEPLOY_PROJECT_ID --format 'value(projectNumber)')

gcloud services enable iam.googleapis.com cloudbuild.googleapis.com clouddeploy.googleapis.com servicenetworking.googleapis.com container.googleapis.com run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

gcloud artifacts repositories create video-intelligence-demo --repository-format=docker --location=europe-west2 --description="Docker repo for video-intelligence-demo"

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID --member=serviceAccount:$DEPLOY_PROJECT_NUMBER@cloudbuild.gserviceaccount.com --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID --member=serviceAccount:$DEPLOY_PROJECT_NUMBER@cloudbuild.gserviceaccount.com --role="roles/run.admin"

gcloud projects add-iam-policy-binding $DEPLOY_PROJECT_ID --member=serviceAccount:$DEPLOY_PROJECT_NUMBER@cloudbuild.gserviceaccount.com --role="roles/owner"

gcloud beta builds triggers import --project=$DEPLOY_PROJECT_ID --source=build/triggers/task-app-trigger.yaml