import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

export function activate(context: vscode.ExtensionContext) {
  const provideCodeActions = (document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext) => {
    const diagnostics = context.diagnostics

    return diagnostics.map(diagnostic => {
      if (diagnostic.code === undefined || typeof diagnostic.code !== 'object' || !('value' in diagnostic.code)) {
        return undefined
      }
      if (diagnostic.source !== "eslint")
        return undefined

      const ruleId = diagnostic.code.value
      const action = new vscode.CodeAction(
        `Disable ${ruleId} project-wide`,
        vscode.CodeActionKind.QuickFix
      )

      action.diagnostics = [diagnostic]
      action.isPreferred = false

      action.command = {
        title: action.title,
        command: "extension.disableEslintRule",
        arguments: [ruleId]
      }

      return action
    }).filter((action): action is vscode.CodeAction => !!action)
  }

  const disposable = vscode.languages.registerCodeActionsProvider(
    { pattern: "**/*.{ts,tsx,jsm,mjs,cjs,jsx,html,vue}" },
    { provideCodeActions },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  )

  const command = vscode.commands.registerCommand("extension.disableEslintRule", async (ruleId: string) => {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      // Find the eslint config file in the workspace and open it for editing
      const possiblePaths = [".eslintrc.yaml", ".eslintrc.yml", ".eslintrc.json"]
      const eslintConfigPath = possiblePaths.map(p => path.join(workspaceFolders[0].uri.fsPath, p)).find(fs.existsSync)
      if (!eslintConfigPath) {
        vscode.window.showErrorMessage(`Could not find ${possiblePaths.join(" or ")} in workspace.`)
        return
      }

      const isJson = eslintConfigPath.endsWith(".json")
      const document = await vscode.workspace.openTextDocument(eslintConfigPath)
      const editor = await vscode.window.showTextDocument(document)
      const indentStyle = editor.options.insertSpaces ? " ".repeat(editor.options.tabSize as number) : "\t"

      // Find where the rules are already in the file
      const lines = document.getText().split("\n")
      const rulesRegex = /^rules:\s*|\s*"rules":\s*\{\s*/gm   // yaml and json
      let rulesLineIndex: number | undefined = lines.findIndex(line => rulesRegex.test(line))
      if (rulesLineIndex === -1)
        rulesLineIndex = undefined

      // If rule has a namespace (ex. react/state-in-constructor), find the last occurrence of a rule from the same
      // namespace (ex. 'react' in this example)
      const ruleNamespace = ruleId.includes('/') ? ruleId.split("/")[0] : undefined
      let insertAfterLineIndex = rulesLineIndex
      if (ruleNamespace && rulesLineIndex !== undefined) {
        for (let i = rulesLineIndex; i < lines.length; i++) {
          if (lines[i].includes(`${ruleNamespace}/`))
            insertAfterLineIndex = i
        }
      }

      let newPosition: vscode.Position

      // json
      if (isJson) {
        // TODO: Add ability to create the rules section like for YAML
        if (rulesLineIndex === undefined) {
          vscode.window.showErrorMessage(`Could not find 'rules' section in ${eslintConfigPath}.`)
          return
        }

        // TODO: Add ability to position after the correct namespace like for YAML
        newPosition = new vscode.Position(rulesLineIndex as number + 1, 0)
        await editor.edit(editBuilder => {
          editBuilder.insert(
            newPosition,
            `${indentStyle}${indentStyle}"${ruleId}": "off",\n`
          )
        })

      // yaml
      } else {
        newPosition = new vscode.Position((insertAfterLineIndex ?? document.lineCount - 1) + 1, 0)
        await editor.edit(editBuilder => {
          const lineToAdd = insertAfterLineIndex === undefined
            ? `\nrules:\n${indentStyle}${ruleId}: off\n`
            : `${indentStyle}${ruleId}: off\n`
          editBuilder.insert(newPosition, lineToAdd)
        })
      }

      // Put the cursor on this new rule line
      editor.selection = new vscode.Selection(newPosition, newPosition)
      editor.revealRange(new vscode.Range(newPosition, newPosition))
    }
  })

  context.subscriptions.push(disposable, command)
}
