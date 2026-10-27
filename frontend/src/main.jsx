import { createRoot } from 'react-dom/client';
import App from './App';
import '../../static/design.css';
import './styles/base.css';
import './styles/home.css';
import './styles/faq.css';
import './styles/workspace.css';
import './styles/usability.css';
createRoot(document.getElementById('root')).render(<App />);
