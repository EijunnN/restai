import type { Cliente, Emisor } from "../types.js";
import { xmlEscape } from "../util.js";

/** Id del nodo <ds:Signature> que se inserta en la firma. */
export const SIGNATURE_ID = "SignatureSP";

/** Namespaces comunes según el tipo de documento raíz. */
export const NS = {
  cac: 'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
  cbc: 'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
  ext: 'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"',
  ds: 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
  sac: 'xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1"',
};

/**
 * Bloque <ext:UBLExtensions> con un ExtensionContent vacío donde se insertará
 * la firma digital. El firmador busca el ExtensionContent para colocar la firma.
 */
export const UBL_EXTENSIONS_PLACEHOLDER = `  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;

/** Bloque <cac:Signature> que referencia la firma digital (#SignatureSP). */
export function signatureBlock(emisor: Emisor): string {
  return `  <cac:Signature>
    <cbc:ID>${xmlEscape(emisor.ruc)}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${xmlEscape(emisor.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${emisor.razonSocial}]]></cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#${SIGNATURE_ID}</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>`;
}

/** Dirección de registro (RegistrationAddress) reutilizable. */
function registrationAddress(e: Emisor): string {
  return `      <cac:RegistrationAddress>
        <cbc:ID>${xmlEscape(e.ubigeo ?? "")}</cbc:ID>
        <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
        <cbc:CityName>${xmlEscape(e.provincia ?? "")}</cbc:CityName>
        <cbc:CountrySubentity>${xmlEscape(e.departamento ?? "")}</cbc:CountrySubentity>
        <cbc:District>${xmlEscape(e.distrito ?? "")}</cbc:District>
        <cac:AddressLine>
          <cbc:Line><![CDATA[${e.direccion ?? "-"}]]></cbc:Line>
        </cac:AddressLine>
        <cac:Country>
          <cbc:IdentificationCode>${xmlEscape(e.codigoPais ?? "PE")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:RegistrationAddress>`;
}

/** Parte del emisor (AccountingSupplierParty). */
export function supplierParty(e: Emisor): string {
  return `  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="SUNAT:Identificador de Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${xmlEscape(e.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${e.nombreComercial ?? e.razonSocial}]]></cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${e.razonSocial}]]></cbc:RegistrationName>
${registrationAddress(e)}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;
}

/** Parte del cliente (AccountingCustomerParty). */
export function customerParty(c: Cliente): string {
  const direccion = c.direccion
    ? `        <cac:RegistrationAddress>
          <cac:AddressLine>
            <cbc:Line><![CDATA[${c.direccion}]]></cbc:Line>
          </cac:AddressLine>
        </cac:RegistrationAddress>\n`
    : "";
  return `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${xmlEscape(c.tipoDoc)}" schemeName="SUNAT:Identificador de Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${xmlEscape(c.numDoc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${c.razonSocial}]]></cbc:RegistrationName>
${direccion}      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;
}
