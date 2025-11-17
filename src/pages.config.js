import Home from './pages/Home';
import Trading from './pages/Trading';
import ExchangeSettings from './pages/ExchangeSettings';
import TradeHistory from './pages/TradeHistory';
import AutoTrading from './pages/AutoTrading';
import Alerts from './pages/Alerts';
import AdminDashboard from './pages/AdminDashboard';
import Backtesting from './pages/Backtesting';
import Insights from './pages/Insights';
import AISignals from './pages/AISignals';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Home": Home,
    "Trading": Trading,
    "ExchangeSettings": ExchangeSettings,
    "TradeHistory": TradeHistory,
    "AutoTrading": AutoTrading,
    "Alerts": Alerts,
    "AdminDashboard": AdminDashboard,
    "Backtesting": Backtesting,
    "Insights": Insights,
    "AISignals": AISignals,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};