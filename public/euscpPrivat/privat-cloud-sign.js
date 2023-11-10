import axios from 'axios'
import { uuid } from 'vue-uuid'

// Docs: https://acsk.privatbank.ua/arch/docs/SmartID.pdf

//                  ┌──────────────────────────────────────────┐                     ┌─────────────────────────────────────────┐    ┌─────────────────────────────────────────┐       ┌─────────────────────────────────────────┐
//                  │                  Сайт                    │                     │              Сервіс ключів              │    │             Мобільний додаток           │       │                 P24 Back                │
//                  └──────────────────────────────────────────┘                     └─────────────────────────────────────────┘    └─────────────────────────────────────────┘       └─────────────────────────────────────────┘

// ┌────────────────────────────────────────────────────────────────────────┬───┐                                         ┌─────► ┌─────────────────────────────────────────┬───┐
// │                                                                        │ 1 │                                         │       │   Користувач авторизується в P24        │ 6 │
// │   Отримуємо сертифікат сервісу ключів                                  └───┤                                         │       └──────────────────────┬──────────────────┴───┘
// │   GET https://acsk.privatbank.ua/cloud/api/back/get-certificates HTTP/1.1  │                                         │       ┌──────────────────────▼──────────────────┬───┐
// │   Content-Type: application/json                                           │                                         │       │   Користувач використовуючи в P24       │ 7 │
// └──────────────────────────────────────┬─────────────────────────────────────┘                                         │       │   сканує Qr код на сторінці сайту       └───┤
//                                        │                                                                               │       └──────────────────────┬──────────────────────┘
// ┌──────────────────────────────────────▼─────────────────────────────────┬───┐                                         │       ┌──────────────────────▼──────────────────┬───┐
// │                                                                        │ 2 │                                         │       │   Користувач вводить пароль             │ 8 │
// │   Отримуємо ідентифікатор сесії                                        └───┤                                         │       │   до свого ключа в хмарі                └───┤
// │   POST https://acsk.privatbank.ua/cloud/api/acquire-operation-id HTTP/1.1  │                                         │       └──────────────────────┬──────────────────────┘
// │   Content-Type: application/json                                           │                                         │       ┌──────────────────────▼──────────────────┬───┐
// └──────────────────────────────────────┬─────────────────────────────────────┘                                         │       │   Користувач натискає кнопку            │ 9 │
//                                        │                                                                               │       │   Підтвердити                           └───┤
// ┌──────────────────────────────────────▼─────────────────────────────────┬───┐                                         │       └──────────────────────┬──────────────────────┘
// │                                                                        │ 3 │                                         │       ┌──────────────────────▼──────────────────┬───┐
// │   Запит на формування підпису                                          └───┤                                         │       │   P24 отримує сертифікат                │ 10│
// │   POST https://acsk.privatbank.ua/cloud/api/sign HTTP/1.1                  │                                         │       │   Сервісу ключів                        └───┤
// │   Content-Type: application/json                                           │                                         │       └──────────────────────┬──────────────────────┘
// └──────────────────────────────────────┬─────────────────────────────────────┘                                         │       ┌──────────────────────▼──────────────────┬───┐
//                                        │                                                                               │       │   P24 отримує ідентифікатор сесії       │ 11│
// ┌──────────────────────────────────────▼─────────────────────────────────┬───┐      ┌──────────────────────────────────┬───┐   └──────────────────────┬──────────────────┴───┘
// │                                                                        │ 4 │      │                                  │ 5 │   ┌──────────────────────▼──────────────────┬───┐     ┌─────────────────────────────────────────┬───┐
// │   Формування та відображення QR-коду                                   └───├─────►│   Сервіс зберігає дані із запиту └───┤   │   P24 надсилає пароль на сервер         │ 12│     │   Сервер P24 підписує запит своїм тех.  │ 13│
// │   GET https://www.privat24.ua/rd/kep?hash=rd/kep                           │      │   на формування підпису              │   │   Приват 24                             └───┤────►│   ключем та відправляє на Сервіс ключів └───┤
// └────────────────────────────────────────────────────────────────────────────┘      └──────────────────────────────────────┘   └─────────────────────────────────────────────┘     └────────────────────────┬────────────────────┘
//                                                                                                                                                                                                             │
//                                                                                     ┌──────────────────────────────────┬───┐                                                                                │
//                                                                                     │                                  │ 14│                                                                                │
//                                                                                     │   Сервіс отримує пароль          └───┤◄───────────────────────────────────────────────────────────────────────────────┘
//                                                                                     │   користувача та формує підпис       │
//                                                                                     └──────────────────┬───────────────────┘
//                                                                                                        │
// ┌────────────────────────────────────────────────────────────────────────┬───┐      ┌──────────────────▼───────────────┬───┐
// │    Сайт отримує підпис (запит від Привату на Back)                     │ 16│◄─────┤                                  │ 15│
// └────────────────────────────────────────────────────────────────────────┴───┘      │   Сервіс відправляє підпис на    └───┤
//                                                                                     │   сайт                               │
//                                                                                     └──────────────────────────────────────┘

const QRCode = window.QRCode
const EUSignCP = window.EUSignCP
const proxyUrl = '/proxy/ProxyHandler.php'

const Base64 = {
	encode: str => btoa(unescape(encodeURIComponent(str))),
	decode: str => decodeURIComponent(escape(window.atob(str))),
}

function log(m) {
	console.log(m)
}

export default class PrivatCloudSign {
	#PREFIX_WEB = 'ASKEP'
	#PREFIX_MOB = 'ASKEPMOBILE'
	#SESSION_EXPIRE_TIME = 900
	#URL = {
		privatBase: 'https://acsk.privatbank.ua/cloud/api/back', // тестовий урл не працює зі слів представника Privat24
		privatAuth: 'https://www.privat24.ua/rd/kep?hash=rd/kep',
		proxyPoint: `${proxyUrl}?address=`,
		certificatesPoint: '/get-certificates',
		operationIdPoint: '/acquire-operation-id',
		signPoint: '/sign',
	}
	// instance Http Client
	#http = null
	#endUserClientSession = null
	qrCode = null
	qrCodeUrl = null
	certificate = null
	operationId = null
	// підписані дані
	signedData = null

	constructor() {
		this.#http = axios.create({
			baseURL: '',
			headers: {
				'Content-Type': 'application/json',
			},
		})

		const UUID = this.#generateUUID()
		this.clientId = `${this.#PREFIX_WEB}_${UUID}`

		try {
			log('Створення нового кінцевого користувача')
			this.endUser = EUSignCP()

			log('Налаштування обробника проксі')
			this.endUser.SetXMLHTTPProxyService(proxyUrl)
			this.endUser.SetErrorMessageLanguage(EU_UA_LANG)
			this.endUser.SetCharset('UTF-8')
			this.endUser.SetJavaStringCompliant(true)

			log('Налаштування ModeSettings')
			const modeSettings = this.endUser.CreateModeSettings()
			modeSettings.SetOfflineMode(false)
			this.endUser.SetModeSettings(modeSettings)

			log('Налаштування ProxySettings')
			const proxySettings = this.endUser.CreateProxySettings()
			proxySettings.SetUseProxy(false)
			proxySettings.SetAnonymous(true)
			proxySettings.SetAddress('')
			proxySettings.SetPort('')
			proxySettings.SetUser('')
			proxySettings.SetPassword('')
			proxySettings.SetSavePassword(false)
			this.endUser.SetProxySettings(proxySettings)

			log('Налаштування FileStoreSettings')
			const fileStoreSettings = this.endUser.CreateFileStoreSettings()
			fileStoreSettings.SetPath('/cert')
			fileStoreSettings.SetSaveLoadedCerts(true)
			this.endUser.SetFileStoreSettings(fileStoreSettings)

			log('Налаштування параметрів CMPSettings')
			const cmpSettings = this.endUser.CreateCMPSettings()
			cmpSettings.SetUseCMP(true)
			cmpSettings.SetAddress('http://acsk.privatbank.ua/services/cmp/')
			cmpSettings.SetPort('80')
			cmpSettings.SetCommonName('')
			this.endUser.SetCMPSettings(cmpSettings)

			log('Налаштування TSPSettings')
			const tspSettings = this.endUser.CreateTSPSettings()
			tspSettings.SetAddress('http://acsk.privatbank.ua/services/tsp/')
			tspSettings.SetPort('80')
			tspSettings.SetGetStamps(true)
			this.endUser.SetTSPSettings(tspSettings)

			log('Налаштування параметрів OCSPSettings')
			const ocspSettings = this.endUser.CreateOCSPSettings()
			ocspSettings.SetAddress('http://acsk.privatbank.ua/services/ocsp/')
			ocspSettings.SetPort('80')
			ocspSettings.SetUseOCSP(true)
			this.endUser.SetOCSPSettings(ocspSettings)

			log('Налаштування параметрів LDAPSettings')
			const lDAPSettings = this.endUser.CreateLDAPSettings()
			this.endUser.SetLDAPSettings(lDAPSettings)
		} catch (e) {
			throw 'PrivatSign init error: ' + JSON.stringify(e)
		}
	}

	#handleErrors(err) {
		if (err.response) {
			err = err.response
		} else {
			return err
		}

		if (err.message) {
			return err.message
		}
		if (err.status === 404) {
			return err.statusText
		}
		if (err.data) {
			err = err.data
			let mess = 'Response error'
			if (err.errors) mess = err.errors
			if (err.Message) mess = err.Message
			return mess
		}
		return err
	}

	#getCurrentTimestamp() {
		const now = new Date()

		const year = now.getFullYear()
		const month = String(now.getMonth() + 1).padStart(2, '0')
		const day = String(now.getDate()).padStart(2, '0')
		const hours = String(now.getHours()).padStart(2, '0')
		const minutes = String(now.getMinutes()).padStart(2, '0')
		const seconds = String(now.getSeconds()).padStart(2, '0')

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
	}

	#generateUUID() {
		return uuid.v1()?.toUpperCase()
	}

	// Отримання сертифікатів [1]
	async #fetchCertificates() {
		try {
			const { data } = await this.#http.get(
				`${this.#URL.proxyPoint}${this.#URL.privatBase}${this.#URL.certificatesPoint}`
			)
			return JSON.parse(this.endUser.ArrayToString(this.endUser.Base64Decode(data)))
		} catch (e) {
			throw this.#handleErrors(e)
		}
	}

	// Отримання клієнтської сесії
	async #creatingClientSession(serverCertBase64) {
		const serverCertBytes = this.endUser.Base64Decode(serverCertBase64)
		this.#endUserClientSession = await this.endUser.ClientDynamicKeySessionCreate(
			this.#SESSION_EXPIRE_TIME,
			serverCertBytes
		)
		// console.log("endUserClientSession", this.#endUserClientSession)
		return this.#endUserClientSession
	}

	/**
	 * Шифрування даних
	 * @param {string} dataToEncrypt
	 * @param {{}} endUserClientSession
	 * @return {string}
	 */
	#encryptingData(dataToEncrypt, endUserClientSession) {
		if (endUserClientSession) {
			const dataToEncryptBytes = this.endUser.StringToArray(dataToEncrypt)
			const encryptedDataBytes = this.endUser.SessionEncrypt(endUserClientSession, dataToEncryptBytes)
			return this.endUser.Base64Encode(encryptedDataBytes)
		} else {
			throw 'encryptingData: clientSession is not defined'
		}
	}

	// Отримання авторизаційних даних
	#gettingAuthData(endUserClientSession) {
		const authDataBytes = endUserClientSession.GetData()
		return this.endUser.Base64Encode(authDataBytes)
	}
	// Зашифрований об'єкт (запит)
	#encryptingRequest(request) {
		if (!this.#endUserClientSession) {
			throw 'encryptingRequest: endUserClientSession is not defined'
		}
		return {
			authData: this.#gettingAuthData(this.#endUserClientSession),
			encryptedData: this.#encryptingData(JSON.stringify(request), this.#endUserClientSession),
		}
	}
	/**
	 * Зашифрований об'єкт (відповідь)
	 * @param {string|{encryptedData:string}} response
	 * @return {{signedData:string}}
	 * @throws {string}
	 */
	#decryptingResponse(response) {
		let { encryptedData } = typeof response === 'string' ? JSON.parse(Base64.decode(response)) : response
		if (!encryptedData) {
			throw 'decryptingResponse: response format is not valid'
		}

		const decryptResponseBytes = this.endUser.SessionDecrypt(this.#endUserClientSession, encryptedData)
		return JSON.parse(this.endUser.ArrayToString(decryptResponseBytes))
	}
	// Creating hash Base64
	#generateHash(dataToHash) {
		const dataToHashBytes = this.endUser.StringToArray(dataToHash)
		return this.endUser.HashData(dataToHashBytes, true)
	}

	/**
	 * Отримання ідентифікатора сесії [2]
	 * @returns {Promise<string>} - ідентифікатор сесії
	 */
	async #fetchOperationId() {
		try {
			const body = this.#encryptingRequest({
				clientId: this.clientId,
			})
			/**
			 * @type {Object}
			 * @property {string} data - дані формату Base64EncodeString
			 */
			const { data } = await this.#http.post(
				`${this.#URL.proxyPoint}${this.#URL.privatBase}${this.#URL.operationIdPoint}`,
				Base64.encode(JSON.stringify(body))
			)

			const { signedData } = this.#decryptingResponse(data)
			if (signedData) {
				const { operationId } = JSON.parse(
					this.endUser.ArrayToString(this.endUser.VerifyDataInternal(signedData).GetData())
				)
				if (operationId) {
					return operationId
				} else {
					throw 'fetchOperationId: operationId is not defined'
				}
			} else {
				throw 'fetchOperationId: signedData is not defined'
			}
		} catch (e) {
			throw this.#handleErrors(e)
		}
	}

	// Формування підпису [3]
	async #fetchSign(dataToSign) {
		if (!this.clientId || !this.operationId || !dataToSign) {
			throw 'required params is not defined'
		}
		try {
			const body = this.#encryptingRequest({
				clientId: this.clientId,
				operationId: this.operationId,
				time: this.#getCurrentTimestamp(),
				originatorDescription: this.#PREFIX_WEB,
				operationDescription: 'askep_operation_description',
				hashes: Array.isArray(dataToSign)
					? dataToSign.map(item => this.#generateHash(item))
					: [this.#generateHash(dataToSign)],
				signatureAlgorithmName: 'DSTU4145',
				signatureFormat: 'PKCS7',
			})
			const { data } = await this.#http.post(
				`${this.#URL.proxyPoint}${this.#URL.privatBase}${this.#URL.signPoint}`,
				Base64.encode(JSON.stringify(body))
			)
			return this.#decryptingResponse(data)
		} catch (e) {
			throw this.#handleErrors(e)
		}
	}

	// Формування та відображення QR-коду [4]
	async generateQrCode(domOutput) {
		try {
			const { certificates } = await this.#fetchCertificates()
			if (certificates?.length) {
				const [certificateFirst] = certificates
				this.certificate = certificateFirst

				await this.#creatingClientSession(this.certificate)

				this.operationId = await this.#fetchOperationId()

				this.signedData = await this.#fetchSign('Data to Sign')

				const body = {
					clientId: this.clientId,
					operationId: this.operationId,
					// операція авторизації, при передачі даного типу, необхідно відобразити тексти для авторизації
					action: 'auth', // sign - операція підпису, при передачі даного типу, необхідно відобразити тексти для підпису
				}
				this.qrCodeUrl = `${this.#URL.privatAuth}/${JSON.stringify(body)}`
				if (QRCode) {
					this.qrCode = new QRCode(domOutput, {
						text: this.qrCodeUrl,
						width: 200,
						height: 200,
						colorDark: '#000000',
						colorLight: '#ffffff',
						correctLevel: QRCode.CorrectLevel.H,
					})
				} else {
					throw 'QRCode library not found, doc -> https://www.npmjs.com/package/qrcodejs'
				}
			} else {
				throw 'Запит сертифікатів завершився помилкою'
			}
		} catch (e) {
			throw this.#handleErrors(e)
		}
	}
}
