FROM python:3.13-slim

# postgresql-client gives us the pg_dump binary that backup/db_backup.py
# shells out to. psycopg2-binary (already in requirements.txt) only gives
# the Python driver, not the CLI tools.
#
# NOTE: Debian's default repo only ships postgresql-client 15, which is
# incompatible with Neon's Postgres 18.x server (pg_dump version must be
# >= server version). We add the official PGDG apt repo to pin v18.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget gnupg lsb-release \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get purge -y --auto-remove wget gnupg lsb-release \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app"]