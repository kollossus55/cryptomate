{
  "functions": [
    {
      "name": "tradingScheduler",
      "schedule": "*/2 * * * *",
      "description": "Runs auto-trading check every 2 minutes for all users"
    },
    {
      "name": "autoTradingWorker",
      "description": "Executes auto-trading logic for a single user"
    }
  ]
}