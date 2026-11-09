const createPage = require('./page');
const { rendererComponent } = require('../../utils/renderer-page');

Component(rendererComponent(createPage('B'), 'todo', 'webview'));
