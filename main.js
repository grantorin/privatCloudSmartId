import './style.css'
import PrivatCloudSign from './public/euscpPrivat/privat-cloud-sign'

const btn = document.getElementById('send')
btn.addEventListener('click', async e => {
	try {
		const euCloudSign = new PrivatCloudSign()
		await euCloudSign.generateQrCode('qrcodeOutput')
	} catch (e) {
		console.error(e)
	}
})
