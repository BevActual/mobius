/**
 * Mobius's shared controls. Every app uses these instead of drawing its own menus, dialogs, popovers, switches and
 * pickers, so they behave and look the same everywhere. Behaviour comes from Base UI; the look comes from ui.css,
 * which uses only the values in tokens.css.
 */
import './ui.css';

export { Menu, PointMenu, type MenuEntry } from './Menu';
