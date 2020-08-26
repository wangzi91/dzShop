import {hostUrl} from '../config/api'

function request (url, method, data, header = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: hostUrl + url, // 仅为示例，并非真实的接口地址
      method: method,
      data: data,
      headers: {
        'content-type': 'application/json' // 默认值
      },
      success: function (res) {
        resolve(res.data)
      },
      fail: function (res) {
        reject(res)
      }
    })
  })
}

function get (obj) {
  return request(obj.url, 'GET', obj.data)
}

function post (obj) {
  return request(obj.url, 'POST', obj.data)
}

export default {
  request,
  get,
  post
}
