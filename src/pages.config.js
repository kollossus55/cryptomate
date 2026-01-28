/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AISignals from './pages/AISignals';
import AdminDashboard from './pages/AdminDashboard';
import Alerts from './pages/Alerts';
import AutoTrading from './pages/AutoTrading';
import Backtesting from './pages/Backtesting';
import ExchangeSettings from './pages/ExchangeSettings';
import Home from './pages/Home';
import Insights from './pages/Insights';
import TradeHistory from './pages/TradeHistory';
import Trading from './pages/Trading';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AISignals": AISignals,
    "AdminDashboard": AdminDashboard,
    "Alerts": Alerts,
    "AutoTrading": AutoTrading,
    "Backtesting": Backtesting,
    "ExchangeSettings": ExchangeSettings,
    "Home": Home,
    "Insights": Insights,
    "TradeHistory": TradeHistory,
    "Trading": Trading,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};