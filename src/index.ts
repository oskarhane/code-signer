import * as fs from 'fs';
import * as path from 'path';
import {SIGNATURE_FILENAME} from './constants';
import {digestDirectory} from './digest';
import {sign} from './sign';
import {InvalidSignatureError, SignatureStatus, SignOptions, VerifyAppResult} from './types';
import {verify} from './verify';

export * from './types';

export const signApp = async (appPath: string, certPath: string, keyPath: string, passphrase?: string): Promise<void> => {
    const digest = await digestDirectory(appPath, [SIGNATURE_FILENAME]);

    const options: SignOptions = {
        certPem: fs.readFileSync(certPath, 'utf8'),
        data: digest,
        privateKeyPem: fs.readFileSync(keyPath, 'utf8'),
        passphrase
    };

    const signature = sign(options);
    fs.writeFileSync(path.join(appPath, SIGNATURE_FILENAME), signature);
};


export const verifyApp = async (appPath: string, rootCertificatePem?: string): Promise<VerifyAppResult> => {

    const signaturePath = path.join(appPath, SIGNATURE_FILENAME);
    if (!fs.existsSync(signaturePath)) {
        return {
            status: 'UNSIGNED'
        };
    }

    const digest = await digestDirectory(appPath, [SIGNATURE_FILENAME]);
    console.log('digest: ', digest);
    const signaturePem = fs.readFileSync(signaturePath, 'utf8');
    console.log('signaturePem: ', signaturePem);
    const result = verify({
        data: digest,
        rootCertificatePem,
        signaturePem
    });

    if (!result.isValid) {
        return Promise.reject(new InvalidSignatureError(result.error));
    }
    const status: SignatureStatus = result.isTrusted ? 'TRUSTED' : 'UNTRUSTED';

    return {
        status,
        signature: signaturePem,
        certificate: result.certificate
    };
};
