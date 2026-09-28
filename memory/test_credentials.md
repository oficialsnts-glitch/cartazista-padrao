# Test Credentials — Cartazista Pro

## Admin Master (Firebase Auth email/password)
- **Email:** oficialsnts@gmail.com
- **Senha:** 0fici@lSnts27
- Papel: administrador master (allowlist em `ADMIN_EMAILS` no app.js).
- Capacidades: botão "Admin" na toolbar, enviar cópias de cartazes a usuários
  (todos ou selecionados), ver todos os cartazes salvos (collectionGroup).
- Observação: a conta foi criada via auto-registro no primeiro login (o app
  registra automaticamente APENAS este e-mail admin caso ainda não exista).

## Login normal (usuários comuns)
- Qualquer conta e-mail/senha válida no Firebase. Não há auto-cadastro para
  e-mails não-admin (precisam ser criados no Firebase Console).
- Login anônimo está DESABILITADO neste projeto Firebase.

## ⚠️ Deploy obrigatório das regras
Para o admin ver cartazes de OUTROS usuários e para o envio de cópias funcionar,
é preciso fazer deploy de `/app/firestore.rules` no projeto Firebase
(`firebase deploy --only firestore:rules` ou colar no Console).
