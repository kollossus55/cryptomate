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