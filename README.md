# Forex Exchange Rate Scraper

Automated web scraper for USD exchange rates from Indonesian banks, deployed on Google Cloud Run with scheduled execution.

## Overview

This application scrapes foreign exchange rates from multiple Indonesian banking websites and exports the data to a configured spreadsheet via API integration.

## Architecture

- **Runtime**: Node.js with Puppeteer for web scraping
- **Deployment**: Google Cloud Run (serverless)
- **Scheduling**: Google Cloud Scheduler
- **Integration**: REST API for data export

## Deployment

1. Deploy to Google Cloud Run from this repository
2. Configure required environment variables for API credentials
3. Set up Cloud Scheduler for automated execution
4. Configure resource allocation (1GB memory, 2 CPU recommended)

## Configuration

Required environment variables:
- API credentials for data export service
- Target spreadsheet identifier
- Application configuration parameters

## Usage

- `GET /` - Service health check
- `POST /scrape` - Execute scraping operation
- Automated execution via Cloud Scheduler

## Local Development

```bash
npm install
npm start
```

Set appropriate environment variables before running locally.

## Requirements

- Google Cloud Platform account
- External API service for data export
- Valid credentials for target banking websites (if required)
