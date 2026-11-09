const SCENES = [
  { id: 'todo', label: 'Todo' },
  { id: 'news', label: '新闻' },
  { id: 'editor', label: '编辑器' },
  { id: 'charts', label: '图表' }
];

function sceneUrl(scene, renderer) {
  if (!SCENES.some((item) => item.id === scene) || !['webview', 'skyline'].includes(renderer)) {
    throw new Error('Invalid scene or renderer');
  }
  const entry = renderer === 'skyline' && scene !== 'editor' ? 'skyline' : 'index';
  return `/pages/${scene}/${entry}`;
}

function rendererInfo(page) {
  const configuredRenderer = page.configuredRenderer || (page.route && page.route.endsWith('/skyline') ? 'skyline' : 'webview');
  const renderer = page.renderer || 'unknown';
  return { configuredRenderer, renderer, rendererFallback: renderer !== 'unknown' && renderer !== configuredRenderer };
}

function rendererPage(definition, scene, configuredRenderer) {
  sceneUrl(scene, configuredRenderer);
  if (scene === 'editor' && configuredRenderer !== 'webview') throw new Error('Editor requires WebView');
  return {
    ...definition,
    configuredRenderer,
    data: {
      ...definition.data,
      configuredRenderer,
      actualRenderer: 'unknown',
      rendererFallback: false,
      supportsSkyline: scene !== 'editor',
      statusBarHeight: 0,
      sceneLinks: SCENES.filter((item) => item.id !== scene).map((item) => ({
        ...item,
        url: sceneUrl(item.id, configuredRenderer),
        label: item.id === 'editor' ? '编辑器 · WebView' : item.label
      }))
    },
    onLoad(...args) {
      this.configuredRenderer = configuredRenderer;
      const info = rendererInfo(this);
      const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : {};
      this.setData({ actualRenderer: info.renderer, rendererFallback: info.rendererFallback, statusBarHeight: windowInfo.statusBarHeight || 0 });
      if (definition.onLoad) return definition.onLoad.apply(this, args);
    },
    onRendererChange(event) {
      if (this.run || this.data.running) return;
      const target = event.detail.value;
      if (!['webview', 'skyline'].includes(target) || target === configuredRenderer) return;
      if (scene === 'editor' && target === 'skyline') return;
      wx.redirectTo({
        url: sceneUrl(scene, target),
        fail: () => wx.showToast({ title: '切换页面失败', icon: 'none' })
      });
    },
    onSceneHome() {
      if (this.run || this.data.running) return;
      wx.redirectTo({
        url: sceneUrl('todo', configuredRenderer),
        fail: () => wx.showToast({ title: '返回首页失败', icon: 'none' })
      });
    }
  };
}

function rendererComponent(definition, scene, configuredRenderer) {
  const { data, configuredRenderer: renderer, ...methods } = rendererPage(definition, scene, configuredRenderer);
  const onLoad = methods.onLoad;
  return {
    data,
    methods: {
      ...methods,
      onLoad(...args) {
        this.configuredRenderer = renderer;
        onLoad.apply(this, args);
      }
    }
  };
}

module.exports = { sceneUrl, rendererInfo, rendererPage, rendererComponent };