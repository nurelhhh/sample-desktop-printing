window.onload = () => {
    const webview = document.querySelector('#webview')
    const loading = document.querySelector('.loading')

    if (webview && loading){
        webview.addEventListener("did-start-loading", () => {
            loading.innerHTML = 'Loading...'
        })
    
        webview.addEventListener("did-stop-loading", () => {
            loading.innerHTML = ''
        })
    }
}