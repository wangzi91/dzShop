const state = {}
const mutations = {
  commitData (state, param) {
    state[param.name] = param.data
  }
}
const actions = {
  // 春节版角色列表
}

export default {
  state,
  mutations,
  actions
}
