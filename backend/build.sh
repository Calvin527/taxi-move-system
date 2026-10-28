
#!/usr/bin/env bash

set -euo pipefail

# Install Python dependencies
python -m pip install -r requirements.txt

# Collect Django static files
python manage.py collectstatic --noinput

# Apply database migrations
python manage.py migrate --noinput