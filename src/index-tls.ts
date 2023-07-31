// Modules to control application life and create native browser window
import { app, BrowserWindow, BrowserView, ipcMain, shell, dialog, Tray, Menu, autoUpdater, PrinterInfo, webContents, screen } from 'electron';
import path from 'path';
import { print, getPrinters, getDefaultPrinter, PrintOptions } from 'pdf-to-printer';
import * as fs from 'fs';
import { Buffer } from 'node:buffer';
import axios from 'axios';
import * as os from 'os'
import log from 'electron-log';
import { promisify } from 'util'
import { v4 as uuidv4 } from 'uuid';

const appFolder = path.dirname(process.execPath)
const updateExe = path.resolve(appFolder, '..', 'Update.exe')
const exeName = path.basename(process.execPath)

// const tlsUrl = 'http://localhost:31776';
const tlsUrl = 'http://10.85.72.36:3004';

const writeFileAsync = promisify(fs.writeFile)
const unlinkAsync = promisify(fs.unlink)

app.setLoginItemSettings({
  openAtLogin: true,
  path: updateExe,
  args: [
    '--processStart', `"${exeName}"`,
    '--process-start-args', `"--hidden"`
  ]
})

if (require('electron-squirrel-startup')) app.quit();
//#region
// Set auto-updater.
const updateServer = 'https://tls-printer-client-update-server.vercel.app';
const updateUrl = `${updateServer}/update/${process.platform}/${app.getVersion()}`;

autoUpdater.setFeedURL({ url: updateUrl });

// setInterval(() => {
//   autoUpdater.checkForUpdates()
// }, 60_000);

// autoUpdater.checkForUpdates()

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
  const dialogOpts = {
    type: 'info',
    buttons: ['Restart', 'Later'],
    title: 'Application Update',
    message: process.platform === 'win32' ? releaseNotes : releaseName,
    detail: 'A new version has been downloaded. Restart the application to apply the updates.'
  }
  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) autoUpdater.quitAndInstall()
  })
})

autoUpdater.on('update-available', () => {
  const dialogOpts = {
    type: 'info',
    title: 'Update available',
    message: updateUrl,
    detail: 'A new version is available. The update is being downloaded automatically.'
  }
  dialog.showMessageBox(dialogOpts);
})

autoUpdater.on('update-not-available', () => {
  const dialogOpts = {
    type: 'info',
    title: 'Update not available',
    message: updateUrl,
    detail: 'You are on the latest version'
  }
  dialog.showMessageBox(dialogOpts);
})


autoUpdater.on('error', (message) => {
  dialog.showErrorBox('There was a problem updating the application', `${message}`)
  console.error(message)
})

//#endregion

let mainWindow: BrowserWindow;
let view: BrowserView;
let tray = null;
let deepLinkValue = "tls-printing"
let frameNumberList: string[] = [];
let fileTempCounter = 0;
let failedPrintingTempFullPath = ''
let failedFrameNumbers: string[] = []
let successPrintFiles: string[] = []
let framenumberPrintQueue: string[] = []
let successFramenumbers: string[] = []

let tlsCookiesValues = "";

let fileSuccessfullyPrintedList: string[] = []
let fileFailedToPrintedList: string[] = []

let isDeepLinkTriggered = false
let printingMode = "Print"

let previousDeeplinkTriggeredWindow: BrowserWindow
let deeplinkTriggeredWindowCounter = 0

let previousAuthWindow: BrowserWindow

const options: PrintOptions = {
  silent: false,
  printDialog: false,
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(deepLinkValue, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(deepLinkValue)
}

const gotTheLock = app.requestSingleInstanceLock()

app.setLoginItemSettings({
  openAtLogin: true,
  enabled: true,
  openAsHidden: false,
  path: process.execPath,
})

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv, workingDirectory, additionalData) => {
    // Someone tried to run a second instance, we should focus our window.

    // Check if there is printing at the moment
    if (framenumberPrintQueue.length > 0) {
      dialog.showErrorBox("Printer is busy", "Currently there is a printing process ongoing. Please try again later");
      log.error('Currently there is a printing process ongoing. Please try again later');
      return
    }

    isDeepLinkTriggered = false

    let currentPath = argv[argv.length - 1];
    let deepLink = deepLinkValue + "://";
    if (currentPath.startsWith(deepLink)) {
      console.log(currentPath);

      isDeepLinkTriggered = true
      deeplinkTriggeredWindowCounter++

      const concatTempOne = currentPath.slice(deepLink.length, currentPath.length - 1);

      const dashIndex = concatTempOne.indexOf('-')
      printingMode = concatTempOne.slice(0, dashIndex)

      console.log('printing mode: ' + printingMode)

      const concatTempTwo = concatTempOne.slice(dashIndex + 1, currentPath.length - 1);

      frameNumberList = concatTempTwo.split(';');
      framenumberPrintQueue = []
      framenumberPrintQueue.push(...frameNumberList);
      log.info('---------- NEW DEEP LINK TRIGGERED ----------')
      log.info('Framenumbers from Deep Link: ' + frameNumberList.join(', '))

      successPrintFiles = []
      failedFrameNumbers = []

      fileSuccessfullyPrintedList = []
      fileFailedToPrintedList = []

      createTempFileForFailedPrinting()
    }

    if (!mainWindow.isDestroyed) {
      if (mainWindow.isMinimized() || mainWindow.isDestroyed()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
    else {
      createWindow();
    }

    mainWindow.setBrowserView(null)
    mainWindow.loadFile('./printingProgress.html')
  })

  // Create mainWindow, load the rest of the app, etc...
  app.whenReady().then(() => {
    createWindow()
    // tray = new Tray('assets/icon.png')
    tray = new Tray(path.join(__dirname, '../assets/icon.ico'))
    tray.setToolTip('Desktop Printing App')
    tray.on('click', () => {
      // Show/hide the main window here
      isDeepLinkTriggered = false
      createWindow()
    });

    const template = [
      {
        label: 'Open',
        click: function () {
          createWindow()
        }
      },
      {
        label: 'Quit',
        click: function () {
          app.quit();
        }
      }
    ]
    const ctxMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(ctxMenu);
  })

  app.on('open-url', (event, url) => {
    dialog.showErrorBox('Welcome Back', `You arrived from: ${url}`)
  })

  //In case fresh start up from deep-linking
  const argv = process.argv
  const lastArg = argv[argv.length - 1]
}

async function createWindow(): Promise<void> {

  console.log(`deeplink counter: ${deeplinkTriggeredWindowCounter}`)

  if (deeplinkTriggeredWindowCounter > 1 && isDeepLinkTriggered) {
    previousDeeplinkTriggeredWindow.close()
  }

  // Normal
  // const windowWidth = isDeepLinkTriggered ? 550 : 320
  // const windowHeight = isDeepLinkTriggered ? 700 : 450

  // Redirect purpose
  const windowWidth = isDeepLinkTriggered ? 550 : 300
  const windowHeight = isDeepLinkTriggered ? 700 : 450

  const screenWidth = screen.getPrimaryDisplay().bounds.width
  const screenHeight = screen.getPrimaryDisplay().bounds.height - 50

  // Center for Printing Progress UI, Bottom-right position for Auth UI 
  const xPos = isDeepLinkTriggered ? (screenWidth / 2) - (windowWidth / 2) : screenWidth - windowWidth
  const yPos = isDeepLinkTriggered ? (screenHeight / 2) - (windowHeight / 2) : screenHeight - windowHeight

  mainWindow = new BrowserWindow({
    width: windowWidth, height: windowHeight,
    webPreferences: {
      preload: __dirname + "/preload.js",
      nodeIntegration: true,
      contextIsolation: true
    },
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/icon.ico'),
    x: xPos,
    y: yPos
  });

  if (isDeepLinkTriggered) {
    previousDeeplinkTriggeredWindow = mainWindow
  } else {
    previousAuthWindow = mainWindow
  }

  view = new BrowserView();
  // mainWindow.loadURL('https://www.google.com/')
  view.setBounds({ x: 0, y: 0, width: windowWidth, height: windowHeight })
  view.webContents.loadURL(tlsUrl + "/ConnectedPrinter")
  mainWindow.setBrowserView(view)
  mainWindow.setResizable(false)

  // mainWindow.loadURL(tlsUrl + "/ConnectedPrinter")

  if (isDeepLinkTriggered) {
    // Send result back to renderer process
    mainWindow.webContents.send("from-framenumbers-total", {
      total: frameNumberList.length,
      data: frameNumberList
    });

    printFrameNumbers();
  }

  mainWindow.loadFile("./index.html");
  mainWindow.on("ready-to-show", () => mainWindow.show());

  mainWindow.on('closed', () => {
    if (isDeepLinkTriggered) {
      deeplinkTriggeredWindowCounter--
      framenumberPrintQueue = []
    }
  })

  // Open external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function getFrameNumberFiles(frameNumber: string): Promise<{ isSuccess: boolean, docs: DocumentAFI[], errorMessage?: string }> {
  var listOfBase64: DocumentAFI[] = [];
  let base64 = "JVBERi0xLjIgCjkgMCBvYmoKPDwKPj4Kc3RyZWFtCkJULyAzMiBUZiggIFlPVVIgVEVYVCBIRVJFICAgKScgRVQKZW5kc3RyZWFtCmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgNSAwIFIKL0NvbnRlbnRzIDkgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9LaWRzIFs0IDAgUiBdCi9Db3VudCAxCi9UeXBlIC9QYWdlcwovTWVkaWFCb3ggWyAwIDAgMjUwIDUwIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1BhZ2VzIDUgMCBSCi9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iagp0cmFpbGVyCjw8Ci9Sb290IDMgMCBSCj4+CiUlRU9G";
  listOfBase64.push({
    base64: base64,
    blobId: 'blobIdExample',
    documentType: 'documentTypeExample'
  })
  listOfBase64.push({
    base64: base64,
    blobId: 'blobIdExample',
    documentType: 'documentTypeExample'
  })
  return {
    docs: listOfBase64,
    isSuccess: true
  }

  // var result = await axios.post(`${tlsUrl}/api/poc-desktop/get-file`, body)

  // try {

  //   if (frameNumber.toLowerCase() === 'dummy') {
  //     var dummyResponse = await axios.get<string>(`${tlsUrl}/api/v1/afi-desktop-printing/get-dummy-file`)

  //     listOfBase64.push({
  //       base64: dummyResponse.data,
  //       blobId: '',
  //       documentType: 'testing'
  //     })

  //     return {
  //       docs: listOfBase64,
  //       isSuccess: true
  //     };
  //   }

  //   if (printingMode === 'Print') {
  //     // EmSigner
  //     var fileEFaktur = await axios.get<DocumentAFI>(`${tlsUrl}/api/v1/afi-desktop-printing/get-emsigner/${frameNumber}`)
  //     listOfBase64.push(fileEFaktur.data);

  //     // MinIO
  //     var fileSupportDocument = await axios.get<DocumentAFI[]>(`${tlsUrl}/api/v1/afi-desktop-printing/get-file-support-document/${frameNumber}`)
  //     for (var currentFile of fileSupportDocument.data) {
  //       listOfBase64.push(currentFile);
  //     }
  //   } else {
  //     var reprintFilesResponse = await axios.get<DocumentAFI[]>(`${tlsUrl}/api/v1/afi-desktop-printing/get-files-for-reprint/${frameNumber}`)

  //     listOfBase64.push(...reprintFilesResponse.data);
  //   }
  //   return {
  //     docs: listOfBase64,
  //     isSuccess: true
  //   };
  // } catch (e: any) {
  //   handleErrorStopperWhilePrinting(`Failed to Get File with error ${e}`)

  //   return {
  //     isSuccess: false,
  //     docs: [],
  //     errorMessage: e.response.data ? `${e.response.data}` : `Failed to get files. ` + e
  //   }
  // }
}

async function validatePrinter(printerName: string): Promise<boolean> {
  let listPrinter = await mainWindow.webContents.getPrintersAsync();
  let defaultPrinter = listPrinter.filter(Q => Q.displayName == printerName)[0];

  if (defaultPrinter == null) {
    dialog.showErrorBox("Printer not found", "Please register a printer");
    return false;
  }

  let currentOptions = defaultPrinter.options as OptionsPrinter;
  let model = currentOptions['printer-make-and-model']

  try {
    const blacklistRes = await axios.get(`${tlsUrl}/api/v1/afi-desktop-printing/get-blacklisted-printer-model`);
    const blacklistModel = blacklistRes.data
    if (model == blacklistModel) {
      // dialog.showErrorBox("Printer Model is Invalid", "You can't print with this printer model");
      // return false;
    }
    return true;
  } catch (e) {
    handleErrorStopperWhilePrinting(`Failed to Get Blacklist Model with error ${e}`)
    return false
  }
}

async function isAuthencticated() {
  let tlsCookies = await mainWindow.webContents.session.cookies.get({ url: tlsUrl });
  let validateAuthenticate = tlsCookies.filter(Q => Q.name.startsWith(".AspNetCore.TLS_Authentication_Cookie"))[0]

  if (validateAuthenticate == null) {
    // log.error("Error to authenticate TLS");
    // dialog.showErrorBox("Failed to Authenticate TLS", "Please sign in to main window");
    return true;
  }
  tlsCookiesValues = validateAuthenticate.name + "=" + validateAuthenticate.value;
  return true;
}

async function printFrameNumbers() {
  if (frameNumberList.length === 0) {
    log.warn('Framenumber list is empty')
    return
  }

  let authenticated = await isAuthencticated();
  if (authenticated == false) {
    return;
  }

  fileTempCounter = 0;

  // Get default printer
  let currentPrinter = await getDefaultPrinter();

  // // Validate printer
  // if (currentPrinter) {
  //   let isPrinterValid = await validatePrinter(currentPrinter?.name);
  //   if (isPrinterValid == false) {
  //     log.error('Validate Printer fail')
  //     return;
  //   }
  //   log.info('Validate Printer success')

  //   const isPrinterMappingValid = await ValidatePrinterMapping(currentPrinter.name);
  //   if (isPrinterMappingValid === false) {
  //     log.error('Validate Printer Mapping fail')
  //     dialog.showErrorBox("Validate Printer Mapping fail", "Please check the Printer Mapping");
  //     return;
  //   }
  //   log.info('Validate Printer Mapping success')
  // } else {
  //   log.error('Could not get Default Printer');
  //   return;
  // }

  // Do printing
  successFramenumbers = []
  for (let i = 0; i < frameNumberList.length; i++) {
    const isSuccess = await printOneFrameNumber(frameNumberList[i]);
    if (isSuccess) {
      const poppedFrameNnumber = framenumberPrintQueue.shift()
      log.info(`Pop frame number ${poppedFrameNnumber} from the queue. Next queue is ${framenumberPrintQueue.length > 0 ? framenumberPrintQueue.join(', ') : 'EMPTY'}`)
      successFramenumbers.push(frameNumberList[i])
    }
  }

  if (successPrintFiles.length != 0) {
    try {
      let config = {
        headers: {
          'Cookie': tlsCookiesValues
        }
      }
      var succedFrameNumber = {
        frameNumbers: successPrintFiles
      };
      if (printingMode === 'Print') {
        await axios.post(`${tlsUrl}/api/v1/afi-desktop-printing/printing-success`, succedFrameNumber, config)
      }
      else if (printingMode === 'Reprint') {
        await axios.post(`${tlsUrl}/api/v1/afi-desktop-printing/reprinting-success`, succedFrameNumber, config)
      }
    }
    catch (e) {
      handleErrorStopperWhilePrinting(`Failed to Notify Succeed Frame Number with error ${e}`)
    }
  }


  // Delete temp file for failed printed framenumbers
  if (failedFrameNumbers.length === 0) {
    deleteTempFailedPrintFile();
  } else {
    appendFailedPrintFile();
  }

  dialog.showMessageBox({
    type: 'info',
    title: 'Print Finished',
    message: `Printing framenumbers has been finished with ${successFramenumbers.length} success and ${frameNumberList.length - successFramenumbers.length} fail`
  });

  framenumberPrintQueue = [];
  failedFrameNumbers = [];
}

function orderingFile(fileResponse: DocumentAFI[]): DocumentAFI[] {
  let currentDocument: DocumentAFI | undefined;
  let listDocument: DocumentAFI[] = [];

  //Ordering file for printing
  for (var docsType = 0; docsType < 7; docsType++) {
    if (docsType == 0) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'E-Faktur');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
    if (docsType == 1) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'E-NIK');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
    else if (docsType == 2) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'SRUT');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
    else if (docsType == 3) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'Cek Fisik');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
    else if (docsType == 4) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'CBU - VIN');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
    else if (docsType == 5) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'CBU - Form A');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
    else if (docsType == 6) {
      currentDocument = fileResponse.find(Q => Q.documentType === 'CBU - PIB');
      if (currentDocument !== undefined) listDocument.push(currentDocument)
    }
  }

  return listDocument;
}

async function printOneFrameNumber(frameNumber: string): Promise<boolean> {
  if (frameNumber == null) {
    return false;
  }
  var basepath = app.getAppPath();
  var fullPath = '';
  log.info('------- Printing frame number: ' + frameNumber)

  mainWindow.webContents.send('from-printing-progress', frameNumber)

  let getFilesResponse = await getFrameNumberFiles(frameNumber);

  if (getFilesResponse.isSuccess === false) {
    fileFailedToPrintedList.push(frameNumber)

    mainWindow.webContents.send('from-files-failed-print', {
      total: fileFailedToPrintedList.length,
      data: fileFailedToPrintedList
    })

    dialog.showErrorBox('Failed to print', getFilesResponse.errorMessage!)

    return false
  }

  let listDocument = getFilesResponse.docs
  // let listDocument: DocumentAFI[]
  // if (frameNumber.toLowerCase() === 'dummy') {
  //   listDocument = getFilesResponse.docs;
  // } else {
  //   listDocument = orderingFile(getFilesResponse.docs);
  // }

  let filePrintedCounter = 0;

  for (var document of listDocument) {
    fileTempCounter++;
    var buf = Buffer.from(document.base64, 'base64');
    var fileName = `${uuidv4()}.pdf`;
    var fileNameForUI = `${document.documentType}.pdf`;
    fullPath = `${basepath}//${fileName}`
    log.info(fullPath)
    let isWriteTempFileSuccess = true
    try {
      await writeFileAsync(fullPath, buf);
    } catch (e) {
      if (e) {
        isWriteTempFileSuccess = false
      }
      handleErrorStopperWhilePrinting(`Failed to write ${fileName} for frame number ${frameNumber}. with error ${e}`)
    } finally {
      if (isWriteTempFileSuccess) {
        log.info(`Success writing temp file ${fileName} for frame number ${frameNumber}`)
      }
    }

    options.silent = true;
    let isPrintSuccess = true
    try {
      if (document.documentType === 'E-NIK' || document.documentType === 'E-Faktur') {
        options.pages = '1-4';
      } else {
        options.pages = undefined;
      }
      await print(fullPath, options);
    }
    catch (e) {
      failedFrameNumbers.push(frameNumber)
      log.error(`Error while printing file ${fileName} for frame number ${frameNumber}.\n${e}`)

      isPrintSuccess = false

      fileFailedToPrintedList.push(`[${frameNumber}] ${fileName}`)

      mainWindow.webContents.send('from-files-failed-print', {
        total: fileFailedToPrintedList.length,
        data: fileFailedToPrintedList
      })
      handleErrorStopperWhilePrinting(`Failed to print ${fileName} for frame number ${frameNumber}. with error ${e}`)
    }
    finally {
      if (isPrintSuccess) {
        log.info(`Success printed file ${fileName} for frame number ${frameNumber}`)

        filePrintedCounter++;
        successPrintFiles.push(frameNumber)

        fileSuccessfullyPrintedList.push(`[${frameNumber}] ${fileNameForUI}`)

        // For Renderer
        mainWindow.webContents.send('from-files-printed', {
          total: fileSuccessfullyPrintedList.length,
          data: fileSuccessfullyPrintedList
        })
      }

      try {
        await unlinkAsync(fullPath);
        log.info(`Success deleting file ${fileName} for frame number ${frameNumber}\n`)
      } catch (e) {
        handleErrorStopperWhilePrinting(`Error while deleting file ${fileName} for frame number ${frameNumber}. with error ${e}`)
      }
    }
  }

  if (filePrintedCounter == listDocument.length) {
    return true;
  }
  return false;
}

async function ValidatePrinterMapping(printerName: string): Promise<boolean> {
  try {
    let config = {
      headers: {
        'Cookie': tlsCookiesValues
      }
    }
    const validationRes = await axios.post(`${tlsUrl}/api/v1/afi-desktop-printing/validate-printer`,
      {
        printerName: printerName,
        hostname: os.hostname()
      }, config)

    const validation = validationRes.data
    return validation
  } catch (e) {
    handleErrorStopperWhilePrinting(`Failed to validate Printer Mapping with error ${e}`)
    return false
  }
}

function createTempFileForFailedPrinting() {
  const dateNow = new Date()
  const failedPrintingTempFileName = `print_failed_list_${dateNow.getDate()}_${dateNow.getMonth() + 1}_${dateNow.getFullYear()}_${dateNow.getHours()}_${dateNow.getMinutes()}_${dateNow.getSeconds()}.txt`;

  const basepath = app.getAppPath()
  failedPrintingTempFullPath = `${basepath}//${failedPrintingTempFileName}`

  try {
    fs.writeFile(failedPrintingTempFullPath, '', err => {
      if (err) {
        log.error(`File for failed printing failed to create!. Error: ${err}`);
        throw err;
      }
      log.info('File for failed printing created!');
    });
  } catch (e) {
    handleErrorStopperWhilePrinting(`Failed to write failed file with error ${e}`)
  }
}

function handleErrorStopperWhilePrinting(message: string) {
  // Reset printing queue so the app does not think it is still busy
  framenumberPrintQueue = [];
  log.error(message)
}

function deleteTempFailedPrintFile() {
  try {
    fs.unlink(failedPrintingTempFullPath, (err) => {
      if (err) {
        log.error(`Error while deleting file ${failedPrintingTempFullPath}`)
        throw err;
      }
      log.info(`Success deleting file ${failedPrintingTempFullPath}`)
    });
  } catch (e) {
    handleErrorStopperWhilePrinting(`Failed to unlink failed print file with error ${e}`)
  }
}

function appendFailedPrintFile() {
  try {
    const fileAppendText = fileFailedToPrintedList.join('\n')
    fs.appendFile(failedPrintingTempFullPath, fileAppendText, err => {
      if (err) throw err;
      console.log('Failed Frame Number File Appended!');
      log.info('Failed Frame Number File Appended!');
    });
  } catch (e) {
    handleErrorStopperWhilePrinting(`Failed to append Frame Number with error ${e}`)
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {

})

// Handle window controls via IPC
ipcMain.on('shell:open', () => {
  const pageDirectory = __dirname.replace('app.asar', 'app.asar.unpacked')
  const pagePath = path.join('file://', pageDirectory, 'index.html')
  shell.openExternal(pagePath)
})

ipcMain.on('greet', (event, args) => {
  console.log('DAPET!')
  console.log(args)
})

ipcMain.on("to-auth-check", async (event, args) => {
  // Check authentication
  const usernameRes = await axios.get(`${tlsUrl}/api/v1/afi-desktop-printing/get-auth-user`);
  const username = usernameRes.data

  // Send result back to renderer process
  mainWindow.webContents.send("from-auth-check", username);
});

ipcMain.on("to-auth-refresh", async (event, args) => {

  console.log('welcome to-auth-refresh')

  // Check authentication
  const usernameRes = await axios.get(`${tlsUrl}/api/v1/afi-desktop-printing/get-auth-user`);
  const username = usernameRes.data

  console.log(`username: ${username}`)

  // Send result back to renderer process
  mainWindow.webContents.send("from-auth-refresh", username);
});