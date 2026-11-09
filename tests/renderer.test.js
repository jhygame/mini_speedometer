const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { sceneUrl, rendererInfo, rendererPage, rendererComponent } = require('../miniprogram/utils/renderer-page');

test('scene URLs preserve the chosen renderer except the WebView-only editor', () => {
  for (const scene of ['todo', 'news', 'charts']) {
    assert.equal(sceneUrl(scene, 'webview'), `/pages/${scene}/index`);
    assert.equal(sceneUrl(scene, 'skyline'), `/pages/${scene}/skyline`);
  }
  assert.equal(sceneUrl('editor', 'skyline'), '/pages/editor/index');
  assert.throws(() => sceneUrl('unknown', 'skyline'));
  assert.throws(() => sceneUrl('todo', 'unknown'));
});

test('actual renderer and fallback are not inferred from requested configuration', () => {
  assert.deepEqual(rendererInfo({ route: 'pages/todo/skyline', renderer: 'webview' }), {
    configuredRenderer: 'skyline', renderer: 'webview', rendererFallback: true
  });
  assert.equal(rendererInfo({ configuredRenderer: 'skyline' }).renderer, 'unknown');
  assert.equal(rendererInfo({ configuredRenderer: 'skyline' }).rendererFallback, false);
  assert.equal(rendererInfo({ configuredRenderer: 'skyline', renderer: 'skyline' }).rendererFallback, false);
});

test('page wrapper preserves initialization and only switches while idle', () => {
  const previousWx = global.wx;
  const navigations = [];
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 24 }),
    redirectTo: (options) => navigations.push(options.url)
  };
  try {
    const definition = rendererPage({ data: { running: false }, onLoad() { this.initialized = true; } }, 'todo', 'skyline');
    const page = { ...definition, renderer: 'webview', setData(patch) { Object.assign(this.data, patch); } };
    page.onLoad();
    assert.equal(page.initialized, true);
    assert.equal(page.data.actualRenderer, 'webview');
    assert.equal(page.data.rendererFallback, true);
    assert.equal(page.data.statusBarHeight, 24);
    assert.ok(page.data.sceneLinks.some((item) => item.url === '/pages/news/skyline'));
    page.onRendererChange({ detail: { value: 'webview' } });
    assert.deepEqual(navigations, ['/pages/todo/index']);
    page.run = {};
    page.onRendererChange({ detail: { value: 'webview' } });
    page.onSceneHome();
    assert.equal(navigations.length, 1);
    page.run = null;
    page.data.running = true;
    page.onRendererChange({ detail: { value: 'webview' } });
    assert.equal(navigations.length, 1);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('editor cannot register a Skyline page or navigate to one', () => {
  assert.throws(() => rendererPage({}, 'editor', 'skyline'));
  const definition = rendererPage({ data: {} }, 'editor', 'webview');
  assert.equal(definition.data.supportsSkyline, false);
  definition.onRendererChange.call({ data: {} }, { detail: { value: 'skyline' } });
});

test('renderer entries, including all Todo variants, register isolated pages from shared factories', () => {
  const previousPage = global.Page;
  const previousComponent = global.Component;
  const registered = [];
  global.Page = (definition) => registered.push({ definition, kind: 'Page' });
  global.Component = (definition) => registered.push({ definition, kind: 'Component' });
  try {
    for (const scene of ['todo', 'news', 'charts']) {
      const createPage = require(`../miniprogram/pages/${scene}/page`);
      assert.equal(typeof createPage, 'function');
      const before = registered.length;
      const entries = scene === 'todo' ? ['index', 'glass', 'skyline'] : ['index', 'skyline'];
      for (const entry of entries) {
        const path = require.resolve(`../miniprogram/pages/${scene}/${entry}`);
        delete require.cache[path];
        require(path);
      }
      assert.equal(registered.length, before + entries.length);
      const webviewEntry = registered[before];
      const skylineEntry = registered[registered.length - 1];
      assert.equal(webviewEntry.kind, scene === 'todo' ? 'Component' : 'Page');
      assert.equal(skylineEntry.kind, webviewEntry.kind);
      const webview = webviewEntry.definition;
      const skyline = skylineEntry.definition;
      assert.equal(webview.data.configuredRenderer, 'webview');
      assert.equal(skyline.data.configuredRenderer, 'skyline');
      assert.notEqual(webview.data, skyline.data);
      assert.equal((webview.methods || webview).onRun.toString(), (skyline.methods || skyline).onRun.toString());
      if (scene === 'todo') {
        const glass = registered[before + 1].definition;
        assert.equal(glass.data.configuredRenderer, 'webview');
        assert.equal(webview.data.variant, 'A');
        assert.equal(glass.data.variant, 'B');
        assert.equal(skyline.data.variant, 'C');
        assert.notEqual(glass.data, webview.data);
        assert.notEqual(glass.data, skyline.data);
        assert.ok([webview, glass, skyline].every((page) => page.data.updateMode === 'uniform'));
      }
    }
  } finally {
    if (previousPage === undefined) delete global.Page;
    else global.Page = previousPage;
    if (previousComponent === undefined) delete global.Component;
    else global.Component = previousComponent;
  }
});

test('all configured routes have complete resources and correct renderer settings', () => {
  const root = resolve(__dirname, '../miniprogram');
  const config = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
  assert.equal(config.renderer, 'webview');
  assert.equal(config.lazyCodeLoading, 'requiredComponents');
  assert.equal(config.rendererOptions.skyline.disableABTest, true);
  for (const route of config.pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(existsSync(resolve(root, `${route}.${extension}`)), `${route}.${extension}`);
    }
    const page = JSON.parse(readFileSync(resolve(root, `${route}.json`), 'utf8'));
    if (route.endsWith('/skyline')) {
      assert.equal(page.renderer, 'skyline');
      assert.equal(page.componentFramework, 'glass-easel');
      assert.equal(page.navigationStyle, 'custom');
      const markup = readFileSync(resolve(root, `${route}.wxml`), 'utf8');
      assert.ok(markup.includes('<include src="./index.wxml" />'));
    } else {
      assert.equal(page.renderer, 'webview');
    }
  }
  assert.ok(!config.pages.includes('pages/editor/skyline'));
});

test('editor entry stays WebView and reports requested and actual engines', () => {
  const { reportEnvironment } = require('../miniprogram/utils/benchmark-page');
  const previousPage = global.Page;
  let page;
  global.Page = (definition) => { page = definition; };
  try {
    const path = require.resolve('../miniprogram/pages/editor/index');
    delete require.cache[path];
    require(path);
    assert.equal(page.configuredRenderer, 'webview');
    assert.equal(page.data.supportsSkyline, false);
    const description = reportEnvironment({ environment: { configuredRenderer: 'skyline', renderer: 'webview' }, clock: 'Date.now' });
    assert.ok(description.includes('skyline'));
    assert.ok(description.includes('webview'));
  } finally {
    if (previousPage === undefined) delete global.Page;
    else global.Page = previousPage;
  }
});

test('project settings do not globally force glass-easel compilation over the mixed ABC page configurations', () => {
  const root = resolve(__dirname, '..');
  const shared = JSON.parse(readFileSync(resolve(root, 'project.config.json'), 'utf8'));
  const privateFile = resolve(root, 'project.private.config.json');
  const local = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, 'utf8')) : {};
  const effective = { ...shared.setting, ...local.setting };
  assert.equal(shared.setting.useGlassEaselForWxml, false);
  assert.equal(effective.useGlassEaselForWxml, false);
});

test('Todo ABC explicitly selects framework/runtime and shares navigation without changing other scenes', () => {
  const root = resolve(__dirname, '../miniprogram');
  for (const entry of ['index', 'glass', 'skyline']) {
    const config = JSON.parse(readFileSync(resolve(root, 'pages', 'todo', `${entry}.json`), 'utf8'));
    assert.equal(config.componentFramework, entry === 'index' ? 'exparser' : 'glass-easel');
    assert.equal(config.glassEaselWebview, entry !== 'index');
    assert.deepEqual(config.usingComponents, {});
    assert.equal(config.renderer, entry === 'skyline' ? 'skyline' : 'webview');
    assert.equal(config.navigationStyle, 'custom');
    assert.equal(config.disableScroll, true);
    if (entry !== 'index') {
      assert.ok(readFileSync(resolve(root, 'pages', 'todo', `${entry}.wxml`), 'utf8')
        .includes('<include src="./index.wxml" />'));
      assert.ok(readFileSync(resolve(root, 'pages', 'todo', `${entry}.wxss`), 'utf8')
        .includes('@import "./index.wxss";'));
    }
  }
  const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
  assert.equal(app.componentFramework, undefined);
  assert.equal(app.glassEaselWebview, undefined);
  assert.equal(app.pages.filter((route) => route.startsWith('pages/todo/')).length, 3);
  for (const scene of ['news', 'editor', 'charts']) {
    const config = JSON.parse(readFileSync(resolve(root, 'pages', scene, 'index.json'), 'utf8'));
    assert.equal(config.renderer, 'webview');
    assert.equal(config.componentFramework, undefined);
  }
});

test('Todo component-page wrapper preserves page lifecycle and renderer metadata', () => {
  const previousWx = global.wx;
  global.wx = { getWindowInfo: () => ({ statusBarHeight: 24 }) };
  try {
    for (const renderer of ['webview', 'skyline']) {
      const definition = rendererComponent({
        data: {},
        onLoad(value) { this.loadedValue = value; },
        onHide() { this.hidden = true; },
        onUnload() { this.unloaded = true; }
      }, 'todo', renderer);
      const page = {
        ...definition.methods,
        data: definition.data,
        renderer,
        setData(patch) { Object.assign(this.data, patch); }
      };
      page.onLoad(17);
      assert.equal(page.loadedValue, 17);
      assert.equal(page.configuredRenderer, renderer);
      assert.equal(page.data.actualRenderer, renderer);
      page.onHide();
      page.onUnload();
      assert.equal(page.hidden, true);
      assert.equal(page.unloaded, true);
    }
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});