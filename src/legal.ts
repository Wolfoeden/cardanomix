/**
 * Angaben zum Betreiber für Impressum und Datenschutzerklärung.
 * Vor dem öffentlichen Start mit echten Daten füllen (§ 5 DDG, Art. 13 DSGVO).
 */
export const operator = {
  name: "",
  street: "",
  city: "",
  email: "",
  phone: "",
  /** z. B. Handelsregister, USt-IdNr. – optional */
  register: "",
};

export const operatorComplete = Boolean(operator.name && operator.street && operator.city && operator.email);
