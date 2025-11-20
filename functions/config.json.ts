{
  "functions": [
    {
      "name": "tradingScheduler",
      "description": "Scheduled function that triggers auto-trading checks for all users every 2 minutes",
      "schedule": "*/2 * * * *",
      "timeout": 300
    },
    {
      "name": "autoTradingWorker",
      "description": "Worker function that executes auto-trading logic for a specific user",
      "timeout": 60
    }
  ]
}