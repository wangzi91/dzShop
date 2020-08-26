import Vue from 'vue'
import App from './App'
import store from './store'
import WXrequest from './utils/wxRequest'
import './utils/css/animate.wxss'

Vue.config.productionTip = false
App.mpType = 'app'
Vue.prototype.$store = store
Vue.prototype.$http = WXrequest

const app = new Vue(App)
app.$mount()
